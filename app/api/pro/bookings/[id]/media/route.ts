// app/api/pro/bookings/[id]/media/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { MediaPhase, MediaType, MediaVisibility } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function upper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
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
    const phase = parsePhase(phaseParam)

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
      select: { id: true, professionalId: true },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
    if (booking.professionalId !== user.professionalProfile.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    const url = pickString(body.url)
    if (!url) return NextResponse.json({ error: 'Missing url.' }, { status: 400 })

    const phase = parsePhase(body.phase)
    if (!phase) return NextResponse.json({ error: 'Invalid phase.' }, { status: 400 })

    const mediaType = parseMediaType(body.mediaType)
    if (!mediaType) return NextResponse.json({ error: 'Invalid mediaType.' }, { status: 400 })

    const visibility = parseVisibility(body.visibility ?? 'PUBLIC')
    if (!visibility) return NextResponse.json({ error: 'Invalid visibility.' }, { status: 400 })

    const thumbUrl = pickString(body.thumbUrl)
    const caption = pickString(body.caption)

    const isEligibleForLooks = body.isEligibleForLooks === true
    const isFeaturedInPortfolio = body.isFeaturedInPortfolio === true

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
      },
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
