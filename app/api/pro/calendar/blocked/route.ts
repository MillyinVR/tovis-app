// app/api/pro/calendar/blocked/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function toDateOrNull(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function minutesBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)
    const from =
      toDateOrNull(url.searchParams.get('from')) ?? new Date(Date.now() - 7 * 24 * 60 * 60_000)
    const to =
      toDateOrNull(url.searchParams.get('to')) ?? new Date(Date.now() + 60 * 24 * 60 * 60_000)

    const blocks = await prisma.calendarBlock.findMany({
      where: { professionalId, startsAt: { lte: to }, endsAt: { gte: from } },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
      orderBy: { startsAt: 'asc' },
      take: 1000,
    })

    return jsonOk(
      {
        blocks: blocks.map((b) => ({
          id: String(b.id),
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          note: b.note ?? null,
          locationId: b.locationId ?? null,
        })),
      },
      200,
    )
  } catch (e) {
    console.error('GET /api/pro/calendar/blocked error:', e)
    return jsonFail(500, 'Failed to load blocked time.')
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePro()
    if (auth.res) return auth.res
    const professionalId = auth.professionalId

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

    const conflict = await prisma.calendarBlock.findFirst({
      where: { professionalId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { id: true },
    })
    if (conflict) return jsonFail(409, 'That time overlaps an existing block.')

    const created = await prisma.calendarBlock.create({
      data: { professionalId, startsAt, endsAt, note: note ?? null },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
    })

    return jsonOk(
      {
        block: {
          id: String(created.id),
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt.toISOString(),
          note: created.note ?? null,
          locationId: created.locationId ?? null,
        },
      },
      201,
    )
  } catch (e) {
    console.error('POST /api/pro/calendar/blocked error:', e)
    return jsonFail(500, 'Failed to create blocked time.')
  }
}
