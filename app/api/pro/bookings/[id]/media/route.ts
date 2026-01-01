// app/api/pro/bookings/[id]/media/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

const CAPTION_MAX = 300
const URL_MAX = 2048

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

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

function upperStatus(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, professionalId: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const urlObj = new URL(req.url)
    const phaseParam = urlObj.searchParams.get('phase')

    const phase = phaseParam == null ? null : parsePhase(phaseParam)
    if (phaseParam != null && !phase) {
      return NextResponse.json({ error: 'Invalid phase query param.' }, { status: 400 })
    }

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

    return NextResponse.json({ ok: true, items }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/bookings/[id]/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await Promise.resolve(ctx.params)
    const bookingId = pickString(id)
    if (!bookingId) return NextResponse.json({ error: 'Missing booking id.' }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as {
      url?: unknown
      thumbUrl?: unknown
      caption?: unknown
      phase?: unknown
      mediaType?: unknown
    }

    const url = safeUrl(body.url)
    if (!url) return NextResponse.json({ error: 'Invalid or missing url.' }, { status: 400 })

    const thumbUrl = body.thumbUrl == null || body.thumbUrl === '' ? null : safeUrl(body.thumbUrl)
    if (body.thumbUrl && !thumbUrl) {
      return NextResponse.json({ error: 'thumbUrl must be a valid http/https URL.' }, { status: 400 })
    }

    const phase = parsePhase(body.phase)
    if (!phase) return NextResponse.json({ error: 'Invalid phase.' }, { status: 400 })

    const mediaType = parseMediaType(body.mediaType)
    if (!mediaType) return NextResponse.json({ error: 'Invalid mediaType.' }, { status: 400 })

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
      if (booking.professionalId !== user.professionalProfile!.id) return { ok: false as const, status: 403, error: 'Forbidden' }

      const status = upperStatus(booking.status)
      if (status === 'CANCELLED') return { ok: false as const, status: 409, error: 'This booking is cancelled.' }
      if (status === 'PENDING') return { ok: false as const, status: 409, error: 'Media uploads require an accepted booking.' }
      if (status === 'COMPLETED' || booking.finishedAt) return { ok: false as const, status: 409, error: 'This booking is completed. Media uploads are locked.' }

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

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ ok: true, item: result.created, advancedTo: result.advancedTo }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
