// app/api/pro/bookings/[id]/media/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const URL_MAX = 2048

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function safeUrl(raw: unknown): string | null {
  const s = pickString(raw)
  if (!s) return null
  if (s.length > URL_MAX) return null

  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
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

type SessionStep =
  | 'NONE'
  | 'CONSULTATION'
  | 'CONSULTATION_PENDING_CLIENT'
  | 'BEFORE_PHOTOS'
  | 'SERVICE_IN_PROGRESS'
  | 'FINISH_REVIEW'
  | 'AFTER_PHOTOS'
  | 'DONE'
  | string

function canUploadPhase(sessionStepRaw: unknown, phase: MediaPhase): boolean {
  const step = upper(sessionStepRaw || 'NONE')

  if (phase === MediaPhase.BEFORE) {
    return (
      step === 'BEFORE_PHOTOS' ||
      step === 'SERVICE_IN_PROGRESS' ||
      step === 'FINISH_REVIEW' ||
      step === 'AFTER_PHOTOS' ||
      step === 'DONE'
    )
  }

  if (phase === MediaPhase.AFTER) {
    return step === 'AFTER_PHOTOS' || step === 'DONE'
  }

  return true
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

    const items = await prisma.mediaAsset.findMany({
      where,
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        mediaType: true,
        visibility: true,
        phase: true,
        caption: true,
        createdAt: true,
        reviewId: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return jsonOk({ items }, 200)
  } catch (e: any) {
    console.error('GET /api/pro/bookings/[id]/media error', e)
    return jsonFail(
      500,
      'Internal server error',
      process.env.NODE_ENV !== 'production' ? { name: e?.name, code: e?.code } : undefined,
    )
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
      url?: unknown
      thumbUrl?: unknown
      caption?: unknown
      phase?: unknown
      mediaType?: unknown
    }

    const url = safeUrl(body.url)
    if (!url) return jsonFail(400, 'Invalid or missing url.')

    const thumbUrl = body.thumbUrl == null || body.thumbUrl === '' ? null : safeUrl(body.thumbUrl)
    if (body.thumbUrl && !thumbUrl) return jsonFail(400, 'thumbUrl must be a valid http/https URL.')

    const phase = parsePhase(body.phase)
    if (!phase) return jsonFail(400, 'Invalid phase.')

    const mediaType = parseMediaType(body.mediaType)
    if (!mediaType) return jsonFail(400, 'Invalid mediaType.')

    const captionRaw = pickString(body.caption)
    const caption = captionRaw ? captionRaw.slice(0, CAPTION_MAX) : null

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

      const status = upper(booking.status)
      if (status === 'CANCELLED') return { ok: false as const, status: 409, error: 'This booking is cancelled.' }
      if (status === 'PENDING') return { ok: false as const, status: 409, error: 'Media uploads require an accepted booking.' }
      if (status === 'COMPLETED' || booking.finishedAt) {
        return { ok: false as const, status: 409, error: 'This booking is completed. Media uploads are locked.' }
      }

      if (!canUploadPhase(booking.sessionStep as SessionStep, phase)) {
        return {
          ok: false as const,
          status: 409,
          error: `You can’t upload ${phase} media at session step: ${String(booking.sessionStep || 'NONE')}.`,
        }
      }

      // 🔒 Booking media is ALWAYS private + never eligible for Looks/portfolio
      const created = await tx.mediaAsset.create({
        data: {
          professionalId: booking.professionalId,
          bookingId: booking.id,
          uploadedByUserId: user.id,
          uploadedByRole: 'PRO',
          url,
          thumbUrl,
          mediaType,
          visibility: MediaVisibility.PRIVATE,
          phase,
          caption,
          isEligibleForLooks: false,
          isFeaturedInPortfolio: false,
          reviewId: null,
        } as any,
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          mediaType: true,
          visibility: true,
          phase: true,
          caption: true,
          createdAt: true,
          reviewId: true,
        },
      })

      // Auto-advance logic:
      const step = upper(booking.sessionStep || 'NONE')
      let advancedTo: string | null = null
      if (phase === MediaPhase.AFTER && step === 'AFTER_PHOTOS') {
        await tx.booking.update({
          where: { id: booking.id },
          data: { sessionStep: 'DONE' as any },
          select: { id: true },
        })
        advancedTo = 'DONE'
      }

      return { ok: true as const, created, advancedTo }
    })

    if (!result.ok) return jsonFail(result.status, result.error)

    return jsonOk({ item: result.created, advancedTo: result.advancedTo }, 200)
  } catch (e: any) {
    console.error('POST /api/pro/bookings/[id]/media error', e)
    return jsonFail(
      500,
      'Internal server error',
      process.env.NODE_ENV !== 'production' ? { name: e?.name, code: e?.code } : undefined,
    )
  }
}
