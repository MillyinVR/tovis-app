// app/api/pro/bookings/[id]/media/route.ts

import { MediaPhase, MediaType, Prisma, Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { uploadProBookingMedia } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import { prisma } from '@/lib/prisma'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const PATH_MAX = 2048
const BUCKET_MAX = 128

const SESSION_BUCKET = BUCKETS.mediaPrivate
const SIGNED_URL_TTL_SECONDS = 60 * 10

type RequestMeta = {
  requestId: string | null
}

type NestedInputJsonValue = Prisma.InputJsonValue | null

type JsonObjectPayload = {
  [key: string]: NestedInputJsonValue
}

function bookingJsonFail(
  code: BookingErrorCode,
  overrides?: {
    message?: string
    userMessage?: string
  },
) {
  const fail = getBookingFailPayload(code, overrides)
  return jsonFail(fail.httpStatus, fail.userMessage, fail.extra)
}

function readRequestMeta(request: Request): RequestMeta {
  const requestId =
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null

  return { requestId }
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function parsePhase(value: unknown): MediaPhase | null {
  const normalized = upper(value)

  if (normalized === 'BEFORE') return MediaPhase.BEFORE
  if (normalized === 'AFTER') return MediaPhase.AFTER
  if (normalized === 'OTHER') return MediaPhase.OTHER

  return null
}

function parseMediaType(value: unknown): MediaType | null {
  const normalized = upper(value)

  if (normalized === 'IMAGE') return MediaType.IMAGE
  if (normalized === 'VIDEO') return MediaType.VIDEO

  return null
}

function safeBucket(raw: unknown): (typeof BUCKETS)[keyof typeof BUCKETS] | null {
  const value = pickString(raw)

  if (!value) return null
  if (value.length > BUCKET_MAX) return null
  if (value === BUCKETS.mediaPrivate) return BUCKETS.mediaPrivate
  if (value === BUCKETS.mediaPublic) return BUCKETS.mediaPublic

  return null
}

function safeStoragePath(raw: unknown): string | null {
  const value = pickString(raw)

  if (!value) return null
  if (value.length > PATH_MAX) return null
  if (value.startsWith('/')) return null
  if (value.includes('..')) return null

  return value
}

function safeCaption(raw: unknown): string | null {
  const value = pickString(raw)

  if (!value) return null

  return value.slice(0, CAPTION_MAX)
}

const BOOKING_MEDIA_PHASE_PATH_SEGMENTS: Record<MediaPhase, string> = {
  [MediaPhase.BEFORE]: 'before',
  [MediaPhase.AFTER]: 'after',
  [MediaPhase.OTHER]: 'other',
}

function mustStartWithBookingPhasePrefix(
  path: string,
  bookingId: string,
  phase: MediaPhase,
): boolean {
  return path.startsWith(
    `bookings/${bookingId}/${BOOKING_MEDIA_PHASE_PATH_SEGMENTS[phase]}/`,
  )
}

function normalizeNestedJsonValue(value: unknown): NestedInputJsonValue {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNestedJsonValue(item))
  }

  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    const output: JsonObjectPayload = {}

    for (const key of Object.keys(input).sort()) {
      output[key] = normalizeNestedJsonValue(input[key])
    }

    return output
  }

  return String(value)
}

function normalizeJsonObjectPayload(value: unknown): JsonObjectPayload {
  if (value === null || value === undefined) {
    return {}
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      value: normalizeNestedJsonValue(value),
    }
  }

  const input = value as Record<string, unknown>
  const output: JsonObjectPayload = {}

  for (const key of Object.keys(input).sort()) {
    output[key] = normalizeNestedJsonValue(input[key])
  }

  return output
}

async function objectExistsViaSignedUrl(
  bucket: string,
  path: string,
): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

    if (error) return false

    const signedUrl = data?.signedUrl
    if (!signedUrl) return false

    const head = await fetch(signedUrl, { method: 'HEAD' }).catch(() => null)

    if (head?.ok) return true
    if (head && (head.status === 403 || head.status === 404)) return false

    const get = await fetch(signedUrl, { method: 'GET' }).catch(() => null)
    return Boolean(get?.ok)
  } catch {
    return false
  }
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId
    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
      },
    })

    if (!booking) {
      return jsonFail(404, 'Booking not found.')
    }

    if (booking.professionalId !== professionalId) {
      return jsonFail(403, 'Forbidden.')
    }

    const url = new URL(req.url)
    const phaseParam = url.searchParams.get('phase')
    const phase = phaseParam === null ? null : parsePhase(phaseParam)

    if (phaseParam !== null && !phase) {
      return jsonFail(400, 'Invalid phase query param.')
    }

    const where: { bookingId: string; phase?: MediaPhase } = { bookingId }

    if (phase) {
      where.phase = phase
    }

    const rows = await prisma.mediaAsset.findMany({
      where,
      select: {
        id: true,
        mediaType: true,
        visibility: true,
        phase: true,
        caption: true,
        createdAt: true,
        reviewId: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,
        url: true,
        thumbUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const items = await Promise.all(
      rows.map(async (media) => {
        const { renderUrl, renderThumbUrl } = await renderMediaUrls({
          storageBucket: media.storageBucket,
          storagePath: media.storagePath,
          thumbBucket: media.thumbBucket,
          thumbPath: media.thumbPath,
          url: media.url,
          thumbUrl: media.thumbUrl,
        })

        return {
          ...media,
          renderUrl,
          renderThumbUrl,
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        }
      }),
    )

    return jsonOk({ items }, 200)
  } catch (error: unknown) {
    console.error('GET /api/pro/bookings/[id]/media error', error)

    captureBookingException({
      error,
      route: 'GET /api/pro/bookings/[id]/media',
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  let idempotencyRecordId: string | null = null

  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId
    const actorUserId = auth.user.id

    if (!actorUserId || !actorUserId.trim()) {
      return bookingJsonFail('FORBIDDEN', {
        message: 'Authenticated actor user id is required.',
        userMessage: 'You are not allowed to upload media for this booking.',
      })
    }

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const rateLimit = await enforceRateLimit({
      bucket: 'pro:media:write',
      key: proRateLimitKey({
        professionalId,
        userId: actorUserId,
        request: req,
      }),
    })

    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = (await req.json().catch(() => ({}))) as {
      storageBucket?: unknown
      storagePath?: unknown
      thumbBucket?: unknown
      thumbPath?: unknown
      caption?: unknown
      phase?: unknown
      mediaType?: unknown
    }

    const storageBucket = safeBucket(body.storageBucket)
    const storagePath = safeStoragePath(body.storagePath)

    if (!storageBucket || !storagePath) {
      return jsonFail(400, 'Missing storageBucket/storagePath.')
    }
    const thumbBucket =
      body.thumbBucket === null ||
      body.thumbBucket === undefined ||
      body.thumbBucket === ''
        ? null
        : safeBucket(body.thumbBucket)

    const thumbPath =
      body.thumbPath === null || body.thumbPath === undefined || body.thumbPath === ''
        ? null
        : safeStoragePath(body.thumbPath)

    if ((thumbBucket && !thumbPath) || (!thumbBucket && thumbPath)) {
      return jsonFail(
        400,
        'thumbBucket and thumbPath must be provided together.',
      )
    }

    const phase = parsePhase(body.phase)

    if (!phase) {
      return jsonFail(400, 'Invalid phase.')
    }

    const mediaType = parseMediaType(body.mediaType)

    if (!mediaType) {
      return jsonFail(400, 'Invalid mediaType.')
    }

    const caption = safeCaption(body.caption)

    if (!mustStartWithBookingPhasePrefix(storagePath, bookingId, phase)) {
      return jsonFail(
        400,
        'storagePath must be under bookings/<bookingId>/<phase>/.',
      )
    }

    if (
      thumbPath &&
      !mustStartWithBookingPhasePrefix(thumbPath, bookingId, phase)
    ) {
      return jsonFail(
        400,
        'thumbPath must be under bookings/<bookingId>/<phase>/.',
      )
    }

    if (storageBucket !== SESSION_BUCKET) {
      return jsonFail(400, `Session media must upload to ${SESSION_BUCKET}.`)
    }

    if (thumbBucket && thumbBucket !== SESSION_BUCKET) {
      return jsonFail(400, `Session thumb must upload to ${SESSION_BUCKET}.`)
    }

    const { requestId } = readRequestMeta(req)

    const idempotency = await beginRouteIdempotency<JsonObjectPayload>({
      request: req,
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_MEDIA_CREATE,
      requestLabel: 'media upload',
      requestBody: {
        professionalId,
        actorUserId,
        bookingId,
        storageBucket,
        storagePath,
        thumbBucket,
        thumbPath,
        caption,
        phase,
        mediaType,
      },
      messages: {
        missingKey: 'Missing idempotency key.',
        inProgress: 'A matching media upload request is already in progress.',
        conflict:
          'This idempotency key was already used with a different request body.',
      },
    })

    if (isRouteIdempotencyHandled(idempotency)) {
      return idempotency.response
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const mainExists = await objectExistsViaSignedUrl(storageBucket, storagePath)

    if (!mainExists) {
      await failStartedRouteIdempotency({
        idempotencyRecordId,
        operation: 'POST /api/pro/bookings/[id]/media',
      })

      idempotencyRecordId = null

      return jsonFail(400, 'Uploaded file not found in storage.')
    }

    if (thumbBucket && thumbPath) {
      const thumbExists = await objectExistsViaSignedUrl(thumbBucket, thumbPath)

      if (!thumbExists) {
        await failStartedRouteIdempotency({
          idempotencyRecordId,
          operation: 'POST /api/pro/bookings/[id]/media',
        })

        idempotencyRecordId = null

        return jsonFail(400, 'Uploaded thumb not found in storage.')
      }
    }

    const result = await uploadProBookingMedia({
      bookingId,
      professionalId,
      uploadedByUserId: actorUserId,
      storageBucket,
      storagePath,
      thumbBucket,
      thumbPath,
      caption,
      phase,
      mediaType,
      requestId,
      idempotencyKey: req.headers.get('idempotency-key'),
    })

    const { renderUrl, renderThumbUrl } = await renderMediaUrls({
      storageBucket: result.created.storageBucket,
      storagePath: result.created.storagePath,
      thumbBucket: result.created.thumbBucket,
      thumbPath: result.created.thumbPath,
      url: result.created.url,
      thumbUrl: result.created.thumbUrl,
    })

    const responseBody = normalizeJsonObjectPayload({
      item: {
        ...result.created,
        renderUrl,
        renderThumbUrl,
        url: renderUrl,
        thumbUrl: renderThumbUrl,
      },
      advancedTo: result.advancedTo,
    })

    await completeRouteIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    await failStartedRouteIdempotency({
      idempotencyRecordId,
      operation: 'POST /api/pro/bookings/[id]/media',
    })

    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/media error', error)

    captureBookingException({
      error,
      route: 'POST /api/pro/bookings/[id]/media',
    })

    return jsonFail(500, 'Internal server error')
  }
}