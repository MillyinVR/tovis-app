// app/api/pro/calendar/blocked/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type PostBody = {
  startsAt?: unknown
  endsAt?: unknown
  note?: unknown
  locationId?: unknown // optional: null/undefined means "all locations"
}

function toDateOrNull(v: unknown) {
  const s = pickString(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

function minutesBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

function clampRange(from: Date, to: Date) {
  // keep it reasonable so nobody accidentally asks for 10 years and DOSes your DB
  const MAX_DAYS = 180
  const min = from
  const max = to

  const ms = max.getTime() - min.getTime()
  const maxMs = MAX_DAYS * 24 * 60 * 60_000
  if (ms <= maxMs) return { from: min, to: max }

  return { from: min, to: new Date(min.getTime() + maxMs) }
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const url = new URL(req.url)

    const defaultFrom = new Date(Date.now() - 7 * 24 * 60 * 60_000)
    const defaultTo = new Date(Date.now() + 60 * 24 * 60 * 60_000)

    let from = toDateOrNull(url.searchParams.get('from')) ?? defaultFrom
    let to = toDateOrNull(url.searchParams.get('to')) ?? defaultTo

    // Heal reversed ranges
    if (to < from) {
      const tmp = from
      from = to
      to = tmp
    }

    ;({ from, to } = clampRange(from, to))

    const blocks = await prisma.calendarBlock.findMany({
      where: { professionalId, startsAt: { lte: to }, endsAt: { gte: from } },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
      orderBy: { startsAt: 'asc' },
      take: 1000,
    })

    return jsonOk(
      {
        blocks: blocks.map((b) => ({
          id: b.id,
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
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    const body = (await req.json().catch(() => ({}))) as PostBody

    const startsAt = toDateOrNull(body?.startsAt)
    const endsAt = toDateOrNull(body?.endsAt)
    const note = pickString(body?.note)
    const locationId = pickString(body?.locationId) // optional

    if (!startsAt || !endsAt) return jsonFail(400, 'Missing startsAt/endsAt.')
    if (endsAt <= startsAt) return jsonFail(400, 'End must be after start.')

    const mins = minutesBetween(startsAt, endsAt)
    if (mins < 15 || mins > 24 * 60) {
      return jsonFail(400, 'Block must be between 15 minutes and 24 hours.')
    }

    // If locationId is provided, validate it belongs to this pro.
    if (locationId) {
      const loc = await prisma.professionalLocation.findFirst({
        where: { id: locationId, professionalId },
        select: { id: true },
      })
      if (!loc) return jsonFail(404, 'Location not found.')
    }

    // Overlap check:
    // - if locationId is null => blocks "all locations" for this pro, so it conflicts with ANY block
    // - if locationId is set => conflicts with:
    //     a) blocks for same locationId
    //     b) blocks that apply to all locations (locationId null)
    const conflictWhere = locationId
      ? {
          professionalId,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          OR: [{ locationId }, { locationId: null }],
        }
      : {
          professionalId,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        }

    const conflict = await prisma.calendarBlock.findFirst({
      where: conflictWhere,
      select: { id: true },
    })
    if (conflict) return jsonFail(409, 'That time overlaps an existing block.')

    const created = await prisma.calendarBlock.create({
      data: {
        professionalId,
        startsAt,
        endsAt,
        note: note ?? null,
        locationId: locationId ?? null,
      },
      select: { id: true, startsAt: true, endsAt: true, note: true, locationId: true },
    })

    return jsonOk(
      {
        block: {
          id: created.id,
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