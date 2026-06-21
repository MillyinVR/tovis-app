// app/api/openings/route.ts
import { clampInt } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { moneyToString } from '@/lib/money'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  LastMinuteOfferType,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  OpeningStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { sanitizeTimeZone } from '@/lib/timeZone'
import { pickPublicTierPlan as pickPublicTierPlanShared } from '@/lib/lastMinute/pickTierPlan'
import {
  openingSelect,
  type OpeningWithDetails,
} from '@/lib/lastMinute/openingSelect'
import {
  mapOpeningServiceDtos,
  mapPublicIncentiveDto,
} from '@/lib/lastMinute/openingDto'

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

type Cursor = {
  startAt: Date
  id: string
} | null

type OpeningQueryRow = OpeningWithDetails

type PublicIncentiveDto = {
  tier: LastMinuteTier
  offerType: LastMinuteOfferType
  label: string
  percentOff: number | null
  amountOff: string | null
  freeAddOnService: { id: string; name: string } | null
}

type OpeningDto = {
  id: string
  professionalId: string
  startAt: string
  endAt: string | null
  note: string | null
  status: OpeningStatus
  visibilityMode: LastMinuteVisibilityMode
  publicVisibleFrom: string | null
  publicVisibleUntil: string | null
  location: {
    id: string
    type: ServiceLocationType
    timeZone: string
    city: string | null
    state: string | null
    formattedAddress: string | null
    lat: string | null
    lng: string | null
  }
  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    professionType: string | null
    locationLabel: string | null
  }
  services: {
    id: string
    openingId: string
    serviceId: string
    offeringId: string
    sortOrder: number
    service: {
      id: string
      name: string
      minPrice: string
      defaultDurationMinutes: number
    }
    offering: {
      id: string
      title: string | null
      salonPriceStartingAt: string | null
      mobilePriceStartingAt: string | null
      salonDurationMinutes: number | null
      mobileDurationMinutes: number | null
      offersInSalon: boolean
      offersMobile: boolean
    }
  }[]
  publicIncentive: PublicIncentiveDto | null
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

function parseLocationType(v: string | null): ServiceLocationType | null {
  const s = pickString(v)?.toUpperCase() ?? ''
  if (s === ServiceLocationType.SALON) return ServiceLocationType.SALON
  if (s === ServiceLocationType.MOBILE) return ServiceLocationType.MOBILE
  return null
}

function buildOpeningsWhere(args: {
  now: Date
  horizon: Date
  cursor: Cursor
  locationType: ServiceLocationType | null
  serviceId: string | null
}): Prisma.LastMinuteOpeningWhereInput {
  const { now, horizon, cursor, locationType, serviceId } = args

  const baseConditions: Prisma.LastMinuteOpeningWhereInput[] = [
    {
      status: OpeningStatus.ACTIVE,
      bookedAt: null,
      cancelledAt: null,
      startAt: { gte: now, lte: horizon },
      publicVisibleFrom: { lte: now },
      OR: [{ publicVisibleUntil: null }, { publicVisibleUntil: { gt: now } }],
      professional: {
        lastMinuteSettings: {
          is: { enabled: true },
        },
      },
      services: {
        some: {
          offering: {
            is: {
              isActive: true,
            },
          },
        },
      },
    },
  ]

  if (locationType) {
    baseConditions.push({ locationType })
  }

  if (serviceId) {
    baseConditions.push({
      services: {
        some: {
          serviceId,
          offering: {
            is: {
              isActive: true,
            },
          },
        },
      },
    })
  }

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

function pickPublicTierPlan(row: OpeningQueryRow, now: Date) {
  return pickPublicTierPlanShared(
    { visibilityMode: row.visibilityMode, tierPlans: row.tierPlans },
    now,
  )
}

function mapOpening(row: OpeningQueryRow, now: Date): OpeningDto {
  const publicPlan = pickPublicTierPlan(row, now)

  return {
    id: row.id,
    professionalId: row.professionalId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt ? row.endAt.toISOString() : null,
    note: row.note ?? null,
    status: row.status,
    visibilityMode: row.visibilityMode,
    publicVisibleFrom: row.publicVisibleFrom ? row.publicVisibleFrom.toISOString() : null,
    publicVisibleUntil: row.publicVisibleUntil ? row.publicVisibleUntil.toISOString() : null,

    location: {
      id: row.locationId,
      type: row.locationType,
      timeZone: row.timeZone,
      city: row.location?.city ?? null,
      state: row.location?.state ?? null,
      formattedAddress: row.location?.formattedAddress ?? null,
      lat: moneyToString(row.location?.lat ?? null),
      lng: moneyToString(row.location?.lng ?? null),
    },

    professional: {
      id: row.professional.id,
      businessName: row.professional.businessName ?? null,
      handle: row.professional.handle ?? null,
      avatarUrl: row.professional.avatarUrl ?? null,
      professionType: row.professional.professionType ?? null,
      locationLabel: row.professional.location ?? null,
    },

    services: mapOpeningServiceDtos(row.services),

    publicIncentive: mapPublicIncentiveDto(publicPlan),
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const url = new URL(req.url)

    const hours = parseHours({
      hoursParam: pickString(url.searchParams.get('hours')),
      daysParam: pickString(url.searchParams.get('days')),
    })

    const take = parseTake(pickString(url.searchParams.get('take')))
    const locationType = parseLocationType(pickString(url.searchParams.get('locationType')))
    const serviceId = pickString(url.searchParams.get('serviceId'))

    const now = new Date()
    const horizon = new Date(now.getTime() + hours * 60 * 60_000)

    const openings: OpeningDto[] = []
    let cursor: Cursor = null

    for (let pageIndex = 0; pageIndex < MAX_PAGES && openings.length < take; pageIndex += 1) {
      const rows: OpeningQueryRow[] = await prisma.lastMinuteOpening.findMany({
        where: buildOpeningsWhere({
          now,
          horizon,
          cursor,
          locationType,
          serviceId,
        }),
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: PAGE_SIZE,
        select: openingSelect,
      })

      if (rows.length === 0) break

      for (const row of rows) {
        if (!openingIsAllowedByWeekday(row)) continue
        if (row.services.length === 0) continue

        openings.push(mapOpening(row, now))
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