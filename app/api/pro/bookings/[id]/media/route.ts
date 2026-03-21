// app/api/pro/bookings/[id]/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { MediaPhase, MediaType } from '@prisma/client'
import { BUCKETS } from '@/lib/storageBuckets'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import {
  getBookingFailPayload,
  isBookingError,
  type BookingErrorCode,
} from '@/lib/booking/errors'
import { uploadProBookingMedia } from '@/lib/booking/writeBoundary'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const PATH_MAX = 2048
const BUCKET_MAX = 128

const SESSION_BUCKET = BUCKETS.mediaPrivate
const SIGNED_URL_TTL_SECONDS = 60 * 10

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

function upper(v: unknown) {
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

function mustStartWithBookingPrefix(path: string, bookingId: string) {
  return path.startsWith(`bookings/${bookingId}/`)
}

/**
 * Verify object exists before writing DB row.
 * For private bucket: createSignedUrl then HEAD/GET it.
 */
async function objectExistsViaSignedUrl(bucket: string, path: string): Promise<boolean> {
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

export async function GET(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString((params as any)?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden.')

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
  } catch (error) {
    console.error('GET /api/pro/bookings/[id]/media error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const proId = auth.professionalId
    const user = auth.user

    const params = await Promise.resolve(ctx.params)
    const bookingId = pickString((params as any)?.id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

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

    const mainExists = await objectExistsViaSignedUrl(storageBucket, storagePath)
    if (!mainExists) {
      return jsonFail(400, 'Uploaded file not found in storage.')
    }

    if (thumbBucket && thumbPath) {
      const thumbExists = await objectExistsViaSignedUrl(thumbBucket, thumbPath)
      if (!thumbExists) {
        return jsonFail(400, 'Uploaded thumb not found in storage.')
      }
    }

    const result = await uploadProBookingMedia({
      bookingId,
      professionalId: proId,
      uploadedByUserId: user.id,
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

    return jsonOk(
      {
        item: {
          ...result.created,
          renderUrl,
          renderThumbUrl,
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        },
        advancedTo: result.advancedTo,
      },
      200,
    )
  } catch (error: unknown) {
    if (isBookingError(error)) {
      return bookingJsonFail(error.code, {
        message: error.message,
        userMessage: error.userMessage,
      })
    }

    console.error('POST /api/pro/bookings/[id]/media error', error)
    return jsonFail(500, 'Internal server error')
  }
}