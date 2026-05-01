// app/api/pro/bookings/[id]/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { MediaPhase, MediaType, Prisma, Role } from '@prisma/client'
import { BUCKETS } from '@/lib/storageBuckets'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { uploadProBookingMedia } from '@/lib/booking/writeBoundary'
import {
  beginIdempotency,
  completeIdempotency,
  failIdempotency,
  IDEMPOTENCY_ROUTES,
} from '@/lib/idempotency'
import { captureBookingException } from '@/lib/observability/bookingEvents'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const PATH_MAX = 2048
const BUCKET_MAX = 128

const SESSION_BUCKET = BUCKETS.mediaPrivate
const SIGNED_URL_TTL_SECONDS = 60 * 10

type RequestMeta = {
  requestId: string | null
  idempotencyKey: string | null
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

function idempotencyMissingKeyFail(): Response {
  return jsonFail(400, 'Missing idempotency key.', {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
  })
}

function idempotencyInProgressFail(): Response {
  return jsonFail(
    409,
    'A matching media upload request is already in progress.',
    {
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    },
  )
}

function idempotencyConflictFail(): Response {
  return jsonFail(
    409,
    'This idempotency key was already used with a different request body.',
    {
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    },
  )
}

function readRequestMeta(request: Request): RequestMeta {
  const requestId =
    pickString(request.headers.get('x-request-id')) ??
    pickString(request.headers.get('request-id')) ??
    null

  const idempotencyKey =
    pickString(request.headers.get('idempotency-key')) ??
    pickString(request.headers.get('x-idempotency-key')) ??
    null

  return { requestId, idempotencyKey }
}

function upper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function parsePhase(v: unknown): MediaPhase | null {
  const s = upper(v)
  if (s === 'BEFORE') return MediaPhase.BEFORE
  if (s === 'AFTER') return MediaPhase.AFTER
  if (s === 'OTHER') return MediaPhase.OTHER
  return null
}

function parseMediaType(v: unknown): MediaType | null {
  const s = upper(v)
  if (s === 'IMAGE') return MediaType.IMAGE
  if (s === 'VIDEO') return MediaType.VIDEO
  return null
}

function safeBucket(raw: unknown): (typeof BUCKETS)[keyof typeof BUCKETS] | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > BUCKET_MAX) return null
  if (s === BUCKETS.mediaPrivate) return BUCKETS.mediaPrivate
  if (s === BUCKETS.mediaPublic) return BUCKETS.mediaPublic
  return null
}

function safeStoragePath(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > PATH_MAX) return null
  if (s.startsWith('/')) return null
  if (s.includes('..')) return null
  return s
}

function safeCaption(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  return s.slice(0, CAPTION_MAX)
}

function mustStartWithBookingPrefix(path: string, bookingId: string): boolean {
  return path.startsWith(`bookings/${bookingId}/`)
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
    const out: JsonObjectPayload = {}

    for (const key of Object.keys(input).sort()) {
      out[key] = normalizeNestedJsonValue(input[key])
    }

    return out
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
  const out: JsonObjectPayload = {}

  for (const key of Object.keys(input).sort()) {
    out[key] = normalizeNestedJsonValue(input[key])
  }

  return out
}

/**
 * Verify object exists before writing DB row.
 * For private bucket: createSignedUrl then HEAD/GET it.
 */
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

    const signed = data?.signedUrl
    if (!signed) return false

    const head = await fetch(signed, { method: 'HEAD' }).catch(() => null)
    if (head?.ok) return true
    if (head && (head.status === 403 || head.status === 404)) return false

    const get = await fetch(signed, { method: 'GET' }).catch(() => null)
    return Boolean(get?.ok)
  } catch {
    return false
  }
}

async function failStartedIdempotency(
  idempotencyRecordId: string | null,
): Promise<void> {
  if (!idempotencyRecordId) return

  await failIdempotency({ idempotencyRecordId }).catch((failError) => {
    console.error(
      'POST /api/pro/bookings/[id]/media idempotency failure update error:',
      failError,
    )
  })
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const professionalId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== professionalId) return jsonFail(403, 'Forbidden.')

    const urlObj = new URL(req.url)
    const phaseParam = urlObj.searchParams.get('phase')
    const phase = phaseParam == null ? null : parsePhase(phaseParam)

    if (phaseParam != null && !phase) {
      return jsonFail(400, 'Invalid phase query param.')
    }

    const where: { bookingId: string; phase?: MediaPhase } = { bookingId }
    if (phase) where.phase = phase

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
      rows.map(async (m) => {
        const { renderUrl, renderThumbUrl } = await renderMediaUrls({
          storageBucket: m.storageBucket,
          storagePath: m.storagePath,
          thumbBucket: m.thumbBucket,
          thumbPath: m.thumbPath,
          url: m.url,
          thumbUrl: m.thumbUrl,
        })

        return {
          ...m,
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
    if (!auth.ok) return auth.res

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
      body.thumbBucket == null || body.thumbBucket === ''
        ? null
        : safeBucket(body.thumbBucket)

    const thumbPath =
      body.thumbPath == null || body.thumbPath === ''
        ? null
        : safeStoragePath(body.thumbPath)

    if ((thumbBucket && !thumbPath) || (!thumbBucket && thumbPath)) {
      return jsonFail(400, 'thumbBucket and thumbPath must be provided together.')
    }

    const phase = parsePhase(body.phase)
    if (!phase) return jsonFail(400, 'Invalid phase.')

    const mediaType = parseMediaType(body.mediaType)
    if (!mediaType) return jsonFail(400, 'Invalid mediaType.')

    const caption = safeCaption(body.caption)

    if (!mustStartWithBookingPrefix(storagePath, bookingId)) {
      return jsonFail(400, 'storagePath must be under bookings/<bookingId>/.')
    }

    if (thumbPath && !mustStartWithBookingPrefix(thumbPath, bookingId)) {
      return jsonFail(400, 'thumbPath must be under bookings/<bookingId>/.')
    }

    if (storageBucket !== SESSION_BUCKET) {
      return jsonFail(400, `Session media must upload to ${SESSION_BUCKET}.`)
    }

    if (thumbBucket && thumbBucket !== SESSION_BUCKET) {
      return jsonFail(400, `Session thumb must upload to ${SESSION_BUCKET}.`)
    }

    const { idempotencyKey } = readRequestMeta(req)

    const idempotency = await beginIdempotency<JsonObjectPayload>({
      actor: {
        actorUserId,
        actorRole: Role.PRO,
      },
      route: IDEMPOTENCY_ROUTES.BOOKING_MEDIA_CREATE,
      key: idempotencyKey,
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
    })

    if (idempotency.kind === 'missing_key') {
      return idempotencyMissingKeyFail()
    }

    if (idempotency.kind === 'in_progress') {
      return idempotencyInProgressFail()
    }

    if (idempotency.kind === 'conflict') {
      return idempotencyConflictFail()
    }

    if (idempotency.kind === 'replay') {
      return jsonOk(idempotency.responseBody, idempotency.responseStatus)
    }

    idempotencyRecordId = idempotency.idempotencyRecordId

    const mainExists = await objectExistsViaSignedUrl(storageBucket, storagePath)
    if (!mainExists) {
      await failStartedIdempotency(idempotencyRecordId)
      idempotencyRecordId = null

      return jsonFail(400, 'Uploaded file not found in storage.')
    }

    if (thumbBucket && thumbPath) {
      const thumbExists = await objectExistsViaSignedUrl(thumbBucket, thumbPath)
      if (!thumbExists) {
        await failStartedIdempotency(idempotencyRecordId)
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

    await completeIdempotency({
      idempotencyRecordId,
      responseStatus: 200,
      responseBody,
    })

    return jsonOk(responseBody, 200)
  } catch (error: unknown) {
    if (idempotencyRecordId) {
      await failStartedIdempotency(idempotencyRecordId)
    }

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