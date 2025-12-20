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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/**
 * GET /api/pro/openings
 * Lists this pro's openings for the next horizon.
 * Query params:
 *  - hours=48   (preferred by UI; 1..168)
 *  - days=7     (fallback; 1..30)
 *  - take=50    (1..100)
 *  - status=ACTIVE|BOOKED|EXPIRED|CANCELLED (optional)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proId = user.professionalProfile.id
    const url = new URL(req.url)

    const hoursRaw = pickString(url.searchParams.get('hours'))
    const daysRaw = pickString(url.searchParams.get('days'))
    const takeRaw = pickString(url.searchParams.get('take'))
    const status = pickString(url.searchParams.get('status')) // optional

    const take = Number(takeRaw ?? 50)
    const limit = Number.isFinite(take) ? clamp(Math.floor(take), 1, 100) : 50

    // Prefer hours if provided, otherwise days
    const hours = hoursRaw != null ? Number(hoursRaw) : null
    const days = daysRaw != null ? Number(daysRaw) : 7

    const horizonHours =
      hours != null && Number.isFinite(hours) ? clamp(Math.floor(hours), 1, 168) : null
    const horizonDays =
      horizonHours == null && Number.isFinite(days) ? clamp(Math.floor(days), 1, 30) : 7

    const now = new Date()
    const horizon = horizonHours != null
      ? new Date(Date.now() + horizonHours * 60 * 60_000)
      : new Date(Date.now() + horizonDays * 24 * 60 * 60_000)

    const openings = await prisma.lastMinuteOpening.findMany({
      where: {
        professionalId: proId,
        startAt: { gte: now, lte: horizon },
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { startAt: 'asc' },
      take: limit,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        discountPct: true,
        note: true,
        serviceId: true,
        offeringId: true,
        service: { select: { id: true, name: true } },
        offering: {
          select: {
            id: true,
            title: true,
            price: true,
            durationMinutes: true,
            service: { select: { name: true } },
          },
        },
        _count: { select: { notifications: true } },
      },
    })

    return NextResponse.json({ openings }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/pro/openings
 * Creates a last-minute opening (next 48h).
 */
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
    const nowMs = Date.now()
    const startMs = startAt.getTime()
    if (startMs < nowMs - 60_000) return NextResponse.json({ error: 'startAt is in the past.' }, { status: 400 })
    if (startMs > nowMs + 48 * 60 * 60_000) {
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
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        discountPct: true,
        note: true,
        serviceId: true,
        offeringId: true,
      },
    })

    return NextResponse.json({ opening }, { status: 201 })
  } catch (e) {
    console.error('POST /api/pro/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/pro/openings?id=...
 * Removes/cancels an opening owned by this pro.
 * If your schema supports status=CANCELLED, we set it (safer for audit/history).
 * Otherwise we hard delete.
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proId = user.professionalProfile.id
    const url = new URL(req.url)
    const id = pickString(url.searchParams.get('id'))
    if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

    const opening = await prisma.lastMinuteOpening.findUnique({
      where: { id },
      select: { id: true, professionalId: true, status: true },
    })
    if (!opening) return NextResponse.json({ error: 'Opening not found.' }, { status: 404 })
    if (opening.professionalId !== proId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

    // Try soft-cancel first. If your enum doesn't include CANCELLED, we fall back to delete.
    try {
      await prisma.lastMinuteOpening.update({
        where: { id },
        data: { status: 'CANCELLED' as any },
      })
      return NextResponse.json({ ok: true, id, mode: 'cancelled' }, { status: 200 })
    } catch (_softFail) {
      await prisma.lastMinuteOpening.delete({ where: { id } })
      return NextResponse.json({ ok: true, id, mode: 'deleted' }, { status: 200 })
    }
  } catch (e) {
    console.error('DELETE /api/pro/openings error', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
