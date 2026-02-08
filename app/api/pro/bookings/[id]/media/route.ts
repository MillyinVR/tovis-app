// app/api/pro/bookings/[id]/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { BookingStatus, MediaPhase, MediaType, MediaVisibility, SessionStep } from '@prisma/client'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const PATH_MAX = 2048
const BUCKET_MAX = 128

// Option A policy: session capture stays private
const SESSION_BUCKET = 'media-private'
const ALLOWED_BUCKETS = new Set(['media-private', 'media-public'])

const SIGNED_URL_TTL_SECONDS = 60 * 10 // 10 minutes

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

function safeBucket(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > BUCKET_MAX) return null
  if (!ALLOWED_BUCKETS.has(s)) return null
  return s
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

/**
 * Flow rules:
 * - BEFORE can be uploaded during consultation + later steps
 * - AFTER only during AFTER_PHOTOS/DONE
 * - OTHER always allowed
 */
function canUploadPhase(sessionStep: SessionStep | null, phase: MediaPhase): boolean {
  const step = sessionStep ?? SessionStep.NONE

  if (phase === MediaPhase.BEFORE) {
    return (
      step === SessionStep.CONSULTATION ||
      step === SessionStep.CONSULTATION_PENDING_CLIENT ||
      step === SessionStep.BEFORE_PHOTOS ||
      step === SessionStep.SERVICE_IN_PROGRESS ||
      step === SessionStep.FINISH_REVIEW ||
      step === SessionStep.AFTER_PHOTOS ||
      step === SessionStep.DONE
    )
  }

  if (phase === MediaPhase.AFTER) {
    return step === SessionStep.AFTER_PHOTOS || step === SessionStep.DONE
  }

  return true
}

function mustStartWithBookingPrefix(path: string, bookingId: string) {
  // uploader uses: bookings/<bookingId>/...
  return path.startsWith(`bookings/${bookingId}/`)
}

function toStablePublicShapedUrl(bucket: string, path: string): string {
  // This is NOT usable for private buckets. It’s just a stable identifier you can log/store.
  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

async function signObjectUrl(bucket: string, path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) return null
  return data?.signedUrl ?? null
}

async function objectExistsViaSignedUrl(bucket: string, path: string): Promise<boolean> {
  const signed = await signObjectUrl(bucket, path)
  if (!signed) return false

  // Some CDNs/storage setups dislike HEAD; try HEAD then GET fallback.
  const head = await fetch(signed, { method: 'HEAD' }).catch(() => null)
  if (head && head.ok) return true
  if (head && (head.status === 403 || head.status === 404)) return false

  const get = await fetch(signed, { method: 'GET' }).catch(() => null)
  return Boolean(get?.ok)
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return jsonFail(400, 'Missing booking id.')

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) return jsonFail(404, 'Booking not found.')
    if (booking.professionalId !== proId) return jsonFail(403, 'Forbidden')

    const urlObj = new URL(req.url)
    const phaseParam = urlObj.searchParams.get('phase')
    const phase = phaseParam == null ? null : parsePhase(phaseParam)
    if (phaseParam != null && !phase) return jsonFail(400, 'Invalid phase query param.')

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

        // storage identity
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,

        // existing url fields (keep returning for compatibility)
        url: true,
        thumbUrl: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // Attach signed URLs for UI rendering (especially for media-private)
    const items = await Promise.all(
      rows.map(async (m) => {
        const signedUrl = await signObjectUrl(m.storageBucket, m.storagePath)
        const signedThumbUrl =
          m.thumbBucket && m.thumbPath ? await signObjectUrl(m.thumbBucket, m.thumbPath) : null

        return {
          ...m,
          signedUrl,
          signedThumbUrl,
        }
      })
    )

    return jsonOk({ items }, 200)
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/media error', e)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const proId = auth.professionalId
    const user = auth.user

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
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
    if (!storageBucket || !storagePath) return jsonFail(400, 'Missing storageBucket/storagePath.')

    // Optional thumb
    const thumbBucket = body.thumbBucket == null || body.thumbBucket === '' ? null : safeBucket(body.thumbBucket)
    const thumbPath = body.thumbPath == null || body.thumbPath === '' ? null : safeStoragePath(body.thumbPath)

    if ((thumbBucket && !thumbPath) || (!thumbBucket && thumbPath)) {
      return jsonFail(400, 'thumbBucket and thumbPath must be provided together.')
    }

    const phase = parsePhase(body.phase)
    if (!phase) return jsonFail(400, 'Invalid phase.')

    const mediaType = parseMediaType(body.mediaType)
    if (!mediaType) return jsonFail(400, 'Invalid mediaType.')

    const caption = safeCaption(body.caption)

    // Enforce storage ownership conventions
    if (!mustStartWithBookingPrefix(storagePath, bookingId)) {
      return jsonFail(400, 'storagePath must be under bookings/<bookingId>/')
    }
    if (thumbPath && !mustStartWithBookingPrefix(thumbPath, bookingId)) {
      return jsonFail(400, 'thumbPath must be under bookings/<bookingId>/')
    }

    // Policy: session capture is private
    if (storageBucket !== SESSION_BUCKET) {
      return jsonFail(400, `Session media must upload to ${SESSION_BUCKET}.`)
    }
    if (thumbBucket && thumbBucket !== SESSION_BUCKET) {
      return jsonFail(400, `Session thumb must upload to ${SESSION_BUCKET}.`)
    }

    // Strong correctness: verify objects exist
    const mainExists = await objectExistsViaSignedUrl(storageBucket, storagePath)
    if (!mainExists) return jsonFail(400, 'Uploaded file not found in storage.')

    if (thumbBucket && thumbPath) {
      const tExists = await objectExistsViaSignedUrl(thumbBucket, thumbPath)
      if (!tExists) return jsonFail(400, 'Uploaded thumb not found in storage.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          professionalId: true,
          status: true,
          sessionStep: true,
          finishedAt: true,
        },
      })

      if (!booking) return { ok: false as const, status: 404, error: 'Booking not found.' }
      if (booking.professionalId !== proId) return { ok: false as const, status: 403, error: 'Forbidden' }

      if (booking.status === BookingStatus.CANCELLED) return { ok: false as const, status: 409, error: 'This booking is cancelled.' }
      if (booking.status === BookingStatus.PENDING) return { ok: false as const, status: 409, error: 'Media uploads require an accepted booking.' }
      if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
        return { ok: false as const, status: 409, error: 'This booking is completed. Media uploads are locked.' }
      }

      if (!canUploadPhase(booking.sessionStep, phase)) {
        return {
          ok: false as const,
          status: 409,
          error: `You can’t upload ${phase} media at session step: ${String(booking.sessionStep || SessionStep.NONE)}.`,
        }
      }

      // Stable identifiers (NOT for rendering private media directly)
      const url = toStablePublicShapedUrl(storageBucket, storagePath)
      const thumbUrl = thumbBucket && thumbPath ? toStablePublicShapedUrl(thumbBucket, thumbPath) : null

      const created = await tx.mediaAsset.create({
        data: {
          professionalId: booking.professionalId,
          bookingId: booking.id,
          uploadedByUserId: user.id,
          uploadedByRole: 'PRO',

          // required storage identity
          storageBucket,
          storagePath,
          thumbBucket,
          thumbPath,

          // “url-shaped identifiers” (UI should use signed URLs from GET)
          url,
          thumbUrl,

          mediaType,
          phase,
          caption,

          visibility: MediaVisibility.PRO_CLIENT,

          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
          reviewId: null,
          reviewLocked: false,
        },
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
      })

      let advancedTo: string | null = null
      if (phase === MediaPhase.AFTER && booking.sessionStep === SessionStep.AFTER_PHOTOS) {
        await tx.booking.update({
          where: { id: booking.id },
          data: { sessionStep: SessionStep.DONE },
          select: { id: true },
        })
        advancedTo = SessionStep.DONE
      }

      return { ok: true as const, created, advancedTo }
    })

    if (!result.ok) return jsonFail(result.status, result.error)

    // Return signed urls in the POST response too (nice UX; saves a refresh)
    const signedUrl = await signObjectUrl(result.created.storageBucket, result.created.storagePath)
    const signedThumbUrl =
      result.created.thumbBucket && result.created.thumbPath
        ? await signObjectUrl(result.created.thumbBucket, result.created.thumbPath)
        : null

    return jsonOk(
      {
        item: {
          ...result.created,
          signedUrl,
          signedThumbUrl,
        },
        advancedTo: result.advancedTo,
      },
      200
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/media error', e)
    return jsonFail(500, 'Internal server error')
  }
}
