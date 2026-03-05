// app/api/pro/bookings/[id]/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { BookingStatus, MediaPhase, MediaType, MediaVisibility, Role, SessionStep } from '@prisma/client'
import { BUCKETS } from '@/lib/storageBuckets'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const PATH_MAX = 2048
const BUCKET_MAX = 128

// Session uploads must go to private bucket
const SESSION_BUCKET = BUCKETS.mediaPrivate
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
  return path.startsWith(`bookings/${bookingId}/`)
}

/**
 * Verify object exists before writing DB row.
 * For private bucket: createSignedUrl then HEAD/GET it.
 */
async function objectExistsViaSignedUrl(bucket: string, path: string): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
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

        // Canonical pointers
        storageBucket: true,
        storagePath: true,
        thumbBucket: true,
        thumbPath: true,

        // Legacy (don’t treat as canonical)
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

          // Optional “response-heal” for old UI that expects url/thumbUrl to be renderable:
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        }
      }),
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
    if (!storageBucket || !storagePath) return jsonFail(400, 'Missing storageBucket/storagePath.')

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

    if (!mustStartWithBookingPrefix(storagePath, bookingId)) {
      return jsonFail(400, 'storagePath must be under bookings/<bookingId>/.')
    }
    if (thumbPath && !mustStartWithBookingPrefix(thumbPath, bookingId)) {
      return jsonFail(400, 'thumbPath must be under bookings/<bookingId>/.')
    }

    // Session media MUST go to private bucket
    if (storageBucket !== SESSION_BUCKET) return jsonFail(400, `Session media must upload to ${SESSION_BUCKET}.`)
    if (thumbBucket && thumbBucket !== SESSION_BUCKET) return jsonFail(400, `Session thumb must upload to ${SESSION_BUCKET}.`)

    // Verify the object exists before writing DB row
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
      if (booking.professionalId !== proId) return { ok: false as const, status: 403, error: 'Forbidden.' }

      if (booking.status === BookingStatus.CANCELLED) {
        return { ok: false as const, status: 409, error: 'This booking is cancelled.' }
      }
      if (booking.status === BookingStatus.PENDING) {
        return { ok: false as const, status: 409, error: 'Media uploads require an accepted booking.' }
      }
      if (booking.status === BookingStatus.COMPLETED || booking.finishedAt) {
        return { ok: false as const, status: 409, error: 'This booking is completed. Media uploads are locked.' }
      }

      if (!canUploadPhase(booking.sessionStep, phase)) {
        return {
          ok: false as const,
          status: 409,
          error: `You can’t upload ${phase} media at session step: ${String(booking.sessionStep ?? SessionStep.NONE)}.`,
        }
      }

      // ✅ Single source of truth: store pointers only.
      // url/thumbUrl stay NULL for new rows.
      const created = await tx.mediaAsset.create({
        data: {
          professionalId: booking.professionalId,
          bookingId: booking.id,
          uploadedByUserId: user.id,
          uploadedByRole: Role.PRO,

          storageBucket,
          storagePath,
          thumbBucket,
          thumbPath,

          url: null,
          thumbUrl: null,

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

      let advancedTo: SessionStep | null = null

      if (phase === MediaPhase.BEFORE) {
        const step = booking.sessionStep ?? SessionStep.NONE
        const canAdvanceFrom =
          step === SessionStep.CONSULTATION ||
          step === SessionStep.CONSULTATION_PENDING_CLIENT ||
          step === SessionStep.BEFORE_PHOTOS

        if (canAdvanceFrom) {
          const beforeCount = await tx.mediaAsset.count({
            where: { bookingId: booking.id, phase: MediaPhase.BEFORE },
          })

          if (beforeCount > 0) {
            await tx.booking.update({
              where: { id: booking.id },
              data: { sessionStep: SessionStep.SERVICE_IN_PROGRESS },
              select: { id: true },
            })
            advancedTo = SessionStep.SERVICE_IN_PROGRESS
          }
        }
      }

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

          // Optional response-heal for old UI:
          url: renderUrl,
          thumbUrl: renderThumbUrl,
        },
        advancedTo: result.advancedTo,
      },
      200,
    )
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/media error', e)
    return jsonFail(500, 'Internal server error')
  }
}