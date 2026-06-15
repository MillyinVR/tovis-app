// app/api/pro/bookings/[id]/media/route.ts

import { MediaPhase, MediaType, Role, UploadSurface } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  consumeUploadSession,
  UploadSessionError,
  validateUploadSession,
} from '@/lib/media/uploadSession'
import {
  beginRouteIdempotency,
  completeRouteIdempotency,
  failStartedRouteIdempotency,
  isRouteIdempotencyHandled,
} from '@/app/api/_utils/idempotency'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  isBookingError,
} from '@/lib/booking/errors'
import { bookingJsonFail } from '@/app/api/_utils/bookingResponses'
import {
  normalizeJsonObjectPayload,
  type JsonObjectPayload,
} from '@/app/api/_utils/jsonPayload'
import { uploadProBookingMedia } from '@/lib/booking/writeBoundary'
import { IDEMPOTENCY_ROUTES } from '@/lib/idempotency'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { captureBookingException } from '@/lib/observability/bookingEvents'
import {
  listProBookingMedia,
  parseMediaPhase,
} from '@/lib/proBookingMedia'
import { safeError } from '@/lib/security/logging'
import { BUCKETS } from '@/lib/storageBuckets'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { enforceRateLimit } from '@/lib/rateLimit/enforce'
import { proRateLimitKey } from '@/lib/rateLimit/identity'
import { rateLimitExceededResponse } from '@/lib/rateLimit/response'

export const dynamic = 'force-dynamic'

const CAPTION_MAX = 300

const SESSION_BUCKET = BUCKETS.mediaPrivate
const SIGNED_URL_TTL_SECONDS = 60 * 10

type RequestMeta = {
  requestId: string | null
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

function parseMediaType(value: unknown): MediaType | null {
  const normalized = upper(value)

  if (normalized === 'IMAGE') return MediaType.IMAGE
  if (normalized === 'VIDEO') return MediaType.VIDEO

  return null
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

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()

    if (!auth.ok) {
      return auth.res
    }

    const professionalId = auth.professionalId
    const params = await resolveRouteParams(ctx)
    const bookingId = pickString(params.id)

    if (!bookingId) {
      return bookingJsonFail('BOOKING_ID_REQUIRED')
    }

    const url = new URL(req.url)
    const phaseParam = url.searchParams.get('phase')
    const phase = phaseParam === null ? null : parseMediaPhase(phaseParam)

    if (phaseParam !== null && !phase) {
      return jsonFail(400, 'Invalid phase query param.')
    }

    const outcome = await listProBookingMedia({
      bookingId,
      professionalId,
      phase,
    })

    if (!outcome.ok) {
      return jsonFail(outcome.status, outcome.error)
    }

    return jsonOk({ items: outcome.items }, 200)
  } catch (error: unknown) {
    console.error('GET /api/pro/bookings/[id]/media error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'GET /api/pro/bookings/[id]/media',
    })

    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: RouteContext) {
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

    const params = await resolveRouteParams(ctx)
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
      uploadSessionId?: unknown
      caption?: unknown
      phase?: unknown
      mediaType?: unknown
    }

    const uploadSessionId = pickString(body.uploadSessionId)

    if (!uploadSessionId) {
      return jsonFail(400, 'Missing uploadSessionId.')
    }

    const phase = parseMediaPhase(body.phase)

    if (!phase) {
      return jsonFail(400, 'Invalid phase.')
    }

    const mediaType = parseMediaType(body.mediaType)

    if (!mediaType) {
      return jsonFail(400, 'Invalid mediaType.')
    }

    const caption = safeCaption(body.caption)

    const { requestId } = readRequestMeta(req)

    // Idempotency is keyed on the upload session (not the storage pointer, which
    // the client never supplies). Begin BEFORE touching the session so a retry
    // replays the cached response instead of re-validating an already-consumed
    // session.
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
        uploadSessionId,
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

    // The storage pointer is read back from the UploadSession the signing route
    // minted — never from the client. Validating also enforces that the session
    // belongs to this pro + booking + phase and hasn't expired or been consumed.
    let session
    try {
      session = await validateUploadSession(prisma, {
        uploadSessionId,
        surface: UploadSurface.PRO_BOOKING_MEDIA,
        professionalId,
        bookingId,
        phase,
        now: new Date(),
      })
    } catch (sessionError: unknown) {
      await failStartedRouteIdempotency({
        idempotencyRecordId,
        operation: 'POST /api/pro/bookings/[id]/media',
      })
      idempotencyRecordId = null

      if (sessionError instanceof UploadSessionError) {
        return jsonFail(sessionError.httpStatus, sessionError.message)
      }
      throw sessionError
    }

    const storageBucket = session.storageBucket
    const storagePath = session.storagePath
    const thumbBucket: string | null = null
    const thumbPath: string | null = null

    if (storageBucket !== SESSION_BUCKET) {
      await failStartedRouteIdempotency({
        idempotencyRecordId,
        operation: 'POST /api/pro/bookings/[id]/media',
      })
      idempotencyRecordId = null
      return jsonFail(400, `Session media must upload to ${SESSION_BUCKET}.`)
    }

    if (!mustStartWithBookingPhasePrefix(storagePath, bookingId, phase)) {
      await failStartedRouteIdempotency({
        idempotencyRecordId,
        operation: 'POST /api/pro/bookings/[id]/media',
      })
      idempotencyRecordId = null
      return jsonFail(
        400,
        'storagePath must be under bookings/<bookingId>/<phase>/.',
      )
    }

    const mainExists = await objectExistsViaSignedUrl(storageBucket, storagePath)

    if (!mainExists) {
      await failStartedRouteIdempotency({
        idempotencyRecordId,
        operation: 'POST /api/pro/bookings/[id]/media',
      })

      idempotencyRecordId = null

      return jsonFail(400, 'Uploaded file not found in storage.')
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

    // Mark the upload session CONSUMED and link it to the created asset. The
    // MediaAsset (bucket,path) unique index already guarantees a single asset
    // per object, so a concurrent double-attach loses at the insert; this is the
    // belt-and-suspenders that also flips the session out of PENDING.
    try {
      await consumeUploadSession(prisma, {
        uploadSessionId,
        mediaAssetId: result.created.id,
        now: new Date(),
      })
    } catch (consumeError: unknown) {
      if (!(consumeError instanceof UploadSessionError)) {
        throw consumeError
      }
      // The asset exists and is valid; a consume conflict only means a racing
      // request already flipped the session. Log and continue.
      console.error('POST /api/pro/bookings/[id]/media consume', {
        code: consumeError.code,
      })
    }

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

    console.error('POST /api/pro/bookings/[id]/media error', {
      error: safeError(error),
    })

    captureBookingException({
      error,
      route: 'POST /api/pro/bookings/[id]/media',
    })

    return jsonFail(500, 'Internal server error')
  }
}