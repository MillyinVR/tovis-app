// app/api/pro/openings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function pickString(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickNumber(v: unknown) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function parseISO(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proId = user.professionalProfile.id
    const body = await req.json().catch(() => ({}))

    const offeringId = pickString(body?.offeringId)
    const startAt = parseISO(body?.startAt)
    const endAt = parseISO(body?.endAt) // optional
    const note = pickString(body?.note)
    const discountPctRaw = pickNumber(body?.discountPct)

    if (!offeringId) return NextResponse.json({ error: 'offeringId is required.' }, { status: 400 })
    if (!startAt) return NextResponse.json({ error: 'startAt is required (ISO string).' }, { status: 400 })
    if (endAt && endAt.getTime() <= startAt.getTime()) {
      return NextResponse.json({ error: 'endAt must be after startAt.' }, { status: 400 })
    }

    // Allow only next 48h (tweak later)
    const now = Date.now()
    const startMs = startAt.getTime()
    if (startMs < now - 60_000) return NextResponse.json({ error: 'startAt is in the past.' }, { status: 400 })
    if (startMs > now + 48 * 60 * 60_000) {
      return NextResponse.json({ error: 'startAt must be within 48 hours for last-minute.' }, { status: 400 })
    }

    const discountPct = discountPctRaw == null ? null : clampInt(discountPctRaw, 0, 80)

    const offering = await prisma.professionalServiceOffering.findFirst({
      where: { id: offeringId, professionalId: proId, isActive: true },
      select: { id: true, serviceId: true },
    })
    if (!offering) return NextResponse.json({ error: 'Offering not found.' }, { status: 404 })

    const settings = await prisma.lastMinuteSettings.findUnique({
      where: { professionalId: proId },
      select: { enabled: true, discountsEnabled: true, blocks: { select: { startAt: true, endAt: true } } },
    })
    if (!settings?.enabled) {
      return NextResponse.json({ error: 'Last-minute openings are disabled for this professional.' }, { status: 409 })
    }
    if (discountPct != null && !settings.discountsEnabled) {
      return NextResponse.json({ error: 'Discounts are disabled for this professional.' }, { status: 409 })
    }

    const blocks = settings.blocks || []
    const proposedEnd = endAt ?? new Date(startAt.getTime() + 60 * 60_000)
    const blocked = blocks.some((b) => startAt < b.endAt && proposedEnd > b.startAt)
    if (blocked) return NextResponse.json({ error: 'This time is blocked from last-minute openings.' }, { status: 409 })

    const opening = await prisma.lastMinuteOpening.create({
      data: {
        professionalId: proId,
        serviceId: offering.serviceId,
        offeringId: offering.id,
        startAt,
        endAt,
        discountPct,
        note,
        status: 'ACTIVE',
      },
    })

    return NextResponse.json({ opening }, { status: 201 })
  } catch (e) {
    console.error('POST /api/pro/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
