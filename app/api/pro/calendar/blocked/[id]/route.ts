// app/api/pro/calendar/blocked/[id]/route.ts
// app/api/pro/calendar/blocked/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function toDateOrNull(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function minutesBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id } = await ctx.params
    const blockId = pickString(id)
    if (!blockId) return jsonFail(400, 'Missing block id.')

    const block = await prisma.calendarBlock.findFirst({
      where: { id: blockId, professionalId },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
    })

    if (!block) return jsonFail(404, 'Block not found.')

    return jsonOk(
      {
        block: {
          id: String(block.id),
          startsAt: block.startsAt.toISOString(),
          endsAt: block.endsAt.toISOString(),
          note: block.note ?? null,
          locationId: block.locationId ?? null,
        },
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/calendar/blocked/[id] error:', e)
    return jsonFail(500, 'Failed to load block.')
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id } = await ctx.params
    const blockId = pickString(id)
    if (!blockId) return jsonFail(400, 'Missing block id.')

    const body = (await req.json().catch(() => ({}))) as any

    const startsAt = toDateOrNull(body?.startsAt)
    const endsAt = toDateOrNull(body?.endsAt)
    const note = pickString(body?.note)

    if (!startsAt || !endsAt) return jsonFail(400, 'Missing startsAt/endsAt.')
    if (endsAt <= startsAt) return jsonFail(400, 'End must be after start.')

    const mins = minutesBetween(startsAt, endsAt)
    if (mins < 15 || mins > 24 * 60) {
      return jsonFail(400, 'Block must be between 15 minutes and 24 hours.')
    }

    const existing = await prisma.calendarBlock.findFirst({
      where: { id: blockId, professionalId },
      select: { id: true },
    })
    if (!existing) return jsonFail(404, 'Not found.')

    const conflict = await prisma.calendarBlock.findFirst({
      where: {
        professionalId,
        id: { not: blockId },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    })
    if (conflict) return jsonFail(409, 'That time overlaps an existing block.')

    const updated = await prisma.calendarBlock.update({
      where: { id: blockId },
      data: { startsAt, endsAt, note: note ?? null },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
    })

    return jsonOk(
      {
        block: {
          id: String(updated.id),
          startsAt: updated.startsAt.toISOString(),
          endsAt: updated.endsAt.toISOString(),
          note: updated.note ?? null,
          locationId: updated.locationId ?? null,
        },
      },
      200,
    )
  } catch (e) {
    console.error('PATCH /api/pro/calendar/blocked/[id] error:', e)
    return jsonFail(500, 'Failed to update block.')
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const { id } = await ctx.params
    const blockId = pickString(id)
    if (!blockId) return jsonFail(400, 'Missing block id.')

    const existing = await prisma.calendarBlock.findFirst({
      where: { id: blockId, professionalId },
      select: { id: true },
    })
    if (!existing) return jsonFail(404, 'Not found.')

    await prisma.calendarBlock.delete({ where: { id: blockId } })

    return jsonOk({ ok: true }, 200)
  } catch (e) {
    console.error('DELETE /api/pro/calendar/blocked/[id] error:', e)
    return jsonFail(500, 'Failed to delete block.')
  }
}
