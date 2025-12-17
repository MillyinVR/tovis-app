// app/api/waitlist/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

function toISODateOrNull(v: any): Date | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'CLIENT' || !user.clientProfile) {
      return NextResponse.json({ error: 'Only clients can join a waitlist.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))

    const professionalId = typeof body?.professionalId === 'string' ? body.professionalId : null
    const serviceId = typeof body?.serviceId === 'string' ? body.serviceId : null
    const mediaId = typeof body?.mediaId === 'string' ? body.mediaId : null

    // We accept either:
    // A) preferredStart + preferredEnd (best)
    // B) desiredFor + flexibilityMinutes (UI-friendly)
    const preferredStart = toISODateOrNull(body?.preferredStart)
    const preferredEnd = toISODateOrNull(body?.preferredEnd)

    const desiredFor = toISODateOrNull(body?.desiredFor)
    const flexibilityMinutes =
      typeof body?.flexibilityMinutes === 'number' && Number.isFinite(body.flexibilityMinutes)
        ? Math.max(15, Math.min(24 * 60, Math.floor(body.flexibilityMinutes)))
        : null

    if (!professionalId) return NextResponse.json({ error: 'Missing professionalId.' }, { status: 400 })
    if (!serviceId) return NextResponse.json({ error: 'Missing serviceId.' }, { status: 400 })

    let start: Date | null = preferredStart
    let end: Date | null = preferredEnd

    if (!start || !end) {
      if (!desiredFor || !flexibilityMinutes) {
        return NextResponse.json(
          { error: 'Provide preferredStart/preferredEnd OR desiredFor + flexibilityMinutes.' },
          { status: 400 },
        )
      }
      // Build a window around desiredFor
      start = new Date(desiredFor.getTime() - flexibilityMinutes * 60_000)
      end = new Date(desiredFor.getTime() + flexibilityMinutes * 60_000)
    }

    if (!start || !end) {
      return NextResponse.json({ error: 'Invalid preferred window.' }, { status: 400 })
    }
    if (end <= start) {
      return NextResponse.json({ error: 'preferredEnd must be after preferredStart.' }, { status: 400 })
    }

    const preferredTimeBucket =
      typeof body?.preferredTimeBucket === 'string' ? body.preferredTimeBucket : null

    // Optional: prevent duplicate ACTIVE entries for same client+pro+service
    const existing = await prisma.waitlistEntry.findFirst({
      where: {
        clientId: user.clientProfile.id,
        professionalId,
        serviceId,
        status: 'ACTIVE',
      },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: 'You already have an active waitlist request for this pro/service.' }, { status: 409 })
    }

    const entry = await prisma.waitlistEntry.create({
      data: {
        clientId: user.clientProfile.id,
        professionalId,
        serviceId,
        mediaId: mediaId || null,
        preferredStart: start,
        preferredEnd: end,
        preferredTimeBucket,
        status: 'ACTIVE',
      },
      select: { id: true, status: true },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (e) {
    console.error('POST /api/waitlist error', e)
    return NextResponse.json({ error: 'Failed to join waitlist.' }, { status: 500 })
  }
}
