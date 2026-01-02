// app/api/pro/calendar/blocked/[id]/route.ts
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

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params

    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }
    const professionalId = (user as any).professionalProfile.id as string

    const block = await prisma.calendarBlock.findFirst({
      where: { id, professionalId },
      select: { id: true, startsAt: true, endsAt: true, note: true },
    })

    if (!block) return NextResponse.json({ error: 'Block not found.' }, { status: 404 })
    return NextResponse.json({ ok: true, block }, { status: 200 })
  } catch (e) {
    console.error('GET /api/pro/calendar/blocked/[id] error:', e)
    return NextResponse.json({ error: 'Failed to load block.' }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params

    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }
    const professionalId = (user as any).professionalProfile.id as string

    const existing = await prisma.calendarBlock.findFirst({
      where: { id, professionalId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

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

    // prevent overlap with other blocks
    const conflict = await prisma.calendarBlock.findFirst({
      where: { professionalId, id: { not: id }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { id: true },
    })
    if (conflict) return NextResponse.json({ error: 'That time overlaps an existing block.' }, { status: 409 })

    const updated = await prisma.calendarBlock.update({
      where: { id },
      data: { startsAt, endsAt, note: note ?? null },
      select: { id: true, startsAt: true, endsAt: true, note: true },
    })

    return NextResponse.json({ ok: true, block: updated }, { status: 200 })
  } catch (e) {
    console.error('PATCH /api/pro/calendar/blocked/[id] error:', e)
    return NextResponse.json({ error: 'Failed to update block.' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params

    const user = await getCurrentUser().catch(() => null)
    if (!user || !isProRole((user as any).role) || !(user as any).professionalProfile?.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
    }
    const professionalId = (user as any).professionalProfile.id as string

    const existing = await prisma.calendarBlock.findFirst({
      where: { id, professionalId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    await prisma.calendarBlock.delete({ where: { id } })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error('DELETE /api/pro/calendar/blocked/[id] error:', e)
    return NextResponse.json({ error: 'Failed to delete block.' }, { status: 500 })
  }
}
