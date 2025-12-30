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

  // Only allow http/https URLs.
  // This blocks "javascript:", "file:", "data:", etc.
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

// ---- Enum parsers (return correct Prisma enum types) -------------------------

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

function parseVisibility(v: unknown): MediaVisibility | null {
  const s = upper(v)
  if (s === 'PUBLIC') return MediaVisibility.PUBLIC
  if (s === 'PRIVATE') return MediaVisibility.PRIVATE
  return null
}

// ---- Flow guardrails ---------------------------------------------------------

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

  // Conservative gates:
  // - BEFORE uploads allowed once we are at/after BEFORE_PHOTOS
  // - AFTER uploads allowed once we are at/after AFTER_PHOTOS
  // - OTHER allowed anytime after booking is accepted (handled elsewhere)
  if (phase === MediaPhase.BEFORE) {
    return step === 'BEFORE_PHOTOS' || step === 'SERVICE_IN_PROGRESS' || step === 'FINISH_REVIEW' || step === 'AFTER_PHOTOS' || step === 'DONE'
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

    // Fail loud if phase is provided but invalid.
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
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        caption: true,
        createdAt: true,
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

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        sessionStep: true,
        finishedAt: true,
      },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const status = upperStatus(booking.status)
    if (status === 'CANCELLED') {
      return NextResponse.json({ error: 'This booking is cancelled.' }, { status: 409 })
    }
    if (status === 'PENDING') {
      return NextResponse.json({ error: 'Media uploads require an accepted booking.' }, { status: 409 })
    }
    if (status === 'COMPLETED' || booking.finishedAt) {
      // You can loosen this later if you want “late uploads”
      return NextResponse.json({ error: 'This booking is completed. Media uploads are locked.' }, { status: 409 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      url?: unknown
      thumbUrl?: unknown
      caption?: unknown
      phase?: unknown
      mediaType?: unknown
      visibility?: unknown
      isEligibleForLooks?: unknown
      isFeaturedInPortfolio?: unknown
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

    const visibility = parseVisibility(body.visibility ?? 'PUBLIC')
    if (!visibility) return NextResponse.json({ error: 'Invalid visibility.' }, { status: 400 })

    const captionRaw = pickString(body.caption)
    const caption = captionRaw ? captionRaw.slice(0, CAPTION_MAX) : null

    // Flow gate: keep the session honest.
    if (!canUploadPhase(booking.sessionStep as SessionStep, phase)) {
      return NextResponse.json(
        { error: `You can’t upload ${phase} media at session step: ${String(booking.sessionStep || 'NONE')}.` },
        { status: 409 },
      )
    }

    const wantsEligible = body.isEligibleForLooks === true
    const wantsFeatured = body.isFeaturedInPortfolio === true

    // Rule: private media can’t be eligible for Looks.
    const isEligibleForLooks = visibility === MediaVisibility.PUBLIC ? wantsEligible : false

    // Rule: “featured” only makes sense if public (portfolio).
    const isFeaturedInPortfolio = visibility === MediaVisibility.PUBLIC ? wantsFeatured : false

    const created = await prisma.mediaAsset.create({
      data: {
        professionalId: booking.professionalId,
        bookingId: booking.id,

        uploadedByUserId: user.id,
        uploadedByRole: 'PRO',

        url,
        thumbUrl,
        mediaType,
        visibility,
        phase,

        caption,
        isEligibleForLooks,
        isFeaturedInPortfolio,
      } as any,
      select: {
        id: true,
        url: true,
        thumbUrl: true,
        mediaType: true,
        visibility: true,
        phase: true,
        caption: true,
        isEligibleForLooks: true,
        isFeaturedInPortfolio: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ ok: true, item: created }, { status: 200 })
  } catch (e) {
    console.error('POST /api/pro/bookings/[id]/media error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
