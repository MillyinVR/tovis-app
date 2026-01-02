// app/api/pro/calendar/blocked/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

function isProRole(role: unknown) {
  const r = typeof role === 'string' ? role.toUpperCase() : ''
  return r === 'PROFESSIONAL' || r === 'PRO'
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function toDateOrNull(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }
    const professionalId = (user as any).professionalProfile.id as string

    const url = new URL(req.url)
    const from = toDateOrNull(url.searchParams.get('from')) ?? new Date(Date.now() - 7 * 24 * 60 * 60_000)
    const to = toDateOrNull(url.searchParams.get('to')) ?? new Date(Date.now() + 60 * 24 * 60 * 60_000)

    const blocks = await prisma.calendarBlock.findMany({
      where: { professionalId, startsAt: { lte: to }, endsAt: { gte: from } },
      select: { id: true, startsAt: true, endsAt: true, note: true },
      orderBy: { startsAt: 'asc' },
      take: 1000,
    })

    return NextResponse.json({ ok: true, blocks }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/calendar/blocked error:', e)
    return NextResponse.json({ error: 'Failed to load blocked time.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }
    const professionalId = (user as any).professionalProfile.id as string

    const body = await req.json().catch(() => ({} as any))
    const startsAt = toDateOrNull(body?.startsAt)
    const endsAt = toDateOrNull(body?.endsAt)
    const note = pickString(body?.note)

    if (!startsAt || !endsAt) return NextResponse.json({ error: 'Missing startsAt/endsAt.' }, { status: 400 })
    if (endsAt <= startsAt) return NextResponse.json({ error: 'End must be after start.' }, { status: 400 })

    const mins = Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)
    if (mins < 15 || mins > 24 * 60) {
      return NextResponse.json({ error: 'Block must be between 15 minutes and 24 hours.' }, { status: 400 })
    }

    const conflict = await prisma.calendarBlock.findFirst({
      where: { professionalId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { id: true },
    })
    if (conflict) return NextResponse.json({ error: 'That time overlaps an existing block.' }, { status: 409 })

    const created = await prisma.calendarBlock.create({
      data: { professionalId, startsAt, endsAt, note: note ?? null },
      select: { id: true, startsAt: true, endsAt: true, note: true },
    })

    return NextResponse.json({ ok: true, block: created }, { status: 201 })
  } catch (e) {
    console.error('POST /api/pro/calendar/blocked error:', e)
    return NextResponse.json({ error: 'Failed to create blocked time.' }, { status: 500 })
  }
}
