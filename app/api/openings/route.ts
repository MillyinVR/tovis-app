// app/api/openings/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { OpeningStatus, Prisma } from '@prisma/client'
import { sanitizeTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

const DEFAULT_HOURS = 48
const MIN_HOURS = 1
const MAX_HOURS = 168
const DEFAULT_TAKE = 50
const MIN_TAKE = 1
const MAX_TAKE = 100
const PAGE_SIZE = 200
const MAX_PAGES = 5

type DisableKey =
  | 'disableMon'
  | 'disableTue'
  | 'disableWed'
  | 'disableThu'
  | 'disableFri'
  | 'disableSat'
  | 'disableSun'

const openingSelect = {
  id: true,
  startAt: true,
  endAt: true,
  discountPct: true,
  note: true,
  offeringId: true,
  serviceId: true,

  timeZone: true,
  locationType: true,
  locationId: true,

  service: {
    select: {
      name: true,
    },
  },
  location: {
    select: {
      city: true,
      state: true,
      formattedAddress: true,
    },
  },
  professional: {
    select: {
      id: true,
      businessName: true,
      handle: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      lastMinuteSettings: {
        select: {
          disableMon: true,
          disableTue: true,
          disableWed: true,
          disableThu: true,
          disableFri: true,
          disableSat: true,
          disableSun: true,
        },
      },
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

type OpeningQueryRow = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingSelect
}>

type OpeningDto = {
  id: string
  startAt: string
  endAt: string | null
  discountPct: number | null
  note: string | null
  offeringId: string | null
  serviceId: string | null
  service: { name: string } | null
  location: {
    id: string
    type: OpeningQueryRow['locationType']
    timeZone: string
    city: string | null
    state: string | null
    formattedAddress: string | null
  }
  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    professionType: string | null
    locationLabel: string | null
  }
}

function clampInt(value: number, min: number, max: number) {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function weekdayDisableKeyInTimeZone(date: Date, timeZone: string): DisableKey {
  const tz = sanitizeTimeZone(timeZone, 'UTC')
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(date)

  switch (weekday) {
    case 'Sun':
      return 'disableSun'
    case 'Mon':
      return 'disableMon'
    case 'Tue':
      return 'disableTue'
    case 'Wed':
      return 'disableWed'
    case 'Thu':
      return 'disableThu'
    case 'Fri':
      return 'disableFri'
    default:
      return 'disableSat'
  }
}

function parseHours(args: { hoursParam: string | null; daysParam: string | null }) {
  const { hoursParam, daysParam } = args

  if (hoursParam) {
    const hours = Number(hoursParam)
    if (Number.isFinite(hours)) {
      return clampInt(hours, MIN_HOURS, MAX_HOURS)
    }
  }

  if (daysParam) {
    const days = Number(daysParam)
    if (Number.isFinite(days)) {
      return clampInt(days * 24, MIN_HOURS, MAX_HOURS)
    }
  }

  return DEFAULT_HOURS
}

function parseTake(takeParam: string | null) {
  const raw = Number(takeParam ?? DEFAULT_TAKE)
  if (!Number.isFinite(raw)) return DEFAULT_TAKE
  return clampInt(raw, MIN_TAKE, MAX_TAKE)
}

function buildOpeningsWhere(args: {
  now: Date
  horizon: Date
  cursor: { startAt: Date; id: string } | null
}): Prisma.LastMinuteOpeningWhereInput {
  const { now, horizon, cursor } = args

  const baseConditions: Prisma.LastMinuteOpeningWhereInput[] = [
    {
      status: OpeningStatus.ACTIVE,
      startAt: { gte: now, lte: horizon },
      professional: {
        lastMinuteSettings: {
          is: { enabled: true },
        },
      },
    },
    {
      OR: [{ offeringId: null }, { offering: { is: { isActive: true } } }],
    },
  ]

  if (!cursor) {
    return { AND: baseConditions }
  }

  const afterCursor: Prisma.LastMinuteOpeningWhereInput = {
    OR: [
      { startAt: { gt: cursor.startAt } },
      {
        AND: [{ startAt: cursor.startAt }, { id: { gt: cursor.id } }],
      },
    ],
  }

  return {
    AND: [...baseConditions, afterCursor],
  }
}

function openingIsAllowedByWeekday(row: OpeningQueryRow) {
  const settings = row.professional.lastMinuteSettings
  if (!settings) return true

  const key = weekdayDisableKeyInTimeZone(row.startAt, row.timeZone)
  return !settings[key]
}

function mapOpening(row: OpeningQueryRow): OpeningDto {
  return {
    id: row.id,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    discountPct: row.discountPct ?? null,
    note: row.note ?? null,

    offeringId: row.offeringId ?? null,
    serviceId: row.serviceId ?? null,
    service: row.service ? { name: row.service.name } : null,

    location: {
      id: row.locationId,
      type: row.locationType,
      timeZone: row.timeZone,
      city: row.location?.city ?? null,
      state: row.location?.state ?? null,
      formattedAddress: row.location?.formattedAddress ?? null,
    },

    professional: {
      id: row.professional.id,
      businessName: row.professional.businessName ?? null,
      handle: row.professional.handle ?? null,
      avatarUrl: row.professional.avatarUrl ?? null,
      professionType: row.professional.professionType ?? null,
      locationLabel: row.professional.location ?? null,
    },
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Unauthorized.')

    const url = new URL(req.url)

    const hours = parseHours({
      hoursParam: pickString(url.searchParams.get('hours')),
      daysParam: pickString(url.searchParams.get('days')),
    })

    const take = parseTake(pickString(url.searchParams.get('take')))

    const now = new Date()
    const horizon = new Date(now.getTime() + hours * 60 * 60_000)

    const openings: OpeningDto[] = []
    let cursor: { startAt: Date; id: string } | null = null

    for (let pageIndex = 0; pageIndex < MAX_PAGES && openings.length < take; pageIndex += 1) {
      const rows: OpeningQueryRow[] = await prisma.lastMinuteOpening.findMany({
        where: buildOpeningsWhere({ now, horizon, cursor }),
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: PAGE_SIZE,
        select: openingSelect,
      })

      if (rows.length === 0) break

      for (const row of rows) {
        if (!openingIsAllowedByWeekday(row)) continue

        openings.push(mapOpening(row))
        if (openings.length >= take) break
      }

      const lastRow = rows.at(-1)
      if (!lastRow) break

      cursor = {
        startAt: lastRow.startAt,
        id: lastRow.id,
      }

      if (rows.length < PAGE_SIZE) break
    }

    return jsonOk({
      openings,
      meta: {
        hours,
        take,
        returned: openings.length,
      },
    })
  } catch (e) {
    console.error('GET /api/openings error', e)
    return jsonFail(500, 'Internal server error.')
  }
}