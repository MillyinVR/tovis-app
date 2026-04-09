// app/api/openings/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
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

const openingSelect = {
  id: true,
  professionalId: true,
  startAt: true,
  endAt: true,
  note: true,
  status: true,
  visibilityMode: true,
  publicVisibleFrom: true,
  publicVisibleUntil: true,
  bookedAt: true,
  cancelledAt: true,
  timeZone: true,
  locationType: true,
  locationId: true,

  location: {
    select: {
      id: true,
      city: true,
      state: true,
      formattedAddress: true,
      lat: true,
      lng: true,
      timeZone: true,
      type: true,
    },
  },

  services: {
    where: {
      offering: {
        is: {
          isActive: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      openingId: true,
      serviceId: true,
      offeringId: true,
      sortOrder: true,
      service: {
        select: {
          id: true,
          name: true,
          minPrice: true,
          defaultDurationMinutes: true,
        },
      },
      offering: {
        select: {
          id: true,
          title: true,
          salonPriceStartingAt: true,
          mobilePriceStartingAt: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
          offersInSalon: true,
          offersMobile: true,
        },
      },
    },
  },

  tierPlans: {
    where: {
      cancelledAt: null,
    },
    orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
    select: {
      id: true,
      tier: true,
      scheduledFor: true,
      offerType: true,
      percentOff: true,
      amountOff: true,
      freeAddOnServiceId: true,
      freeAddOnService: {
        select: {
          id: true,
          name: true,
        },
      },
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

function clampInt(value: number, min: number, max: number) {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function decimalToString(value: Prisma.Decimal | null): string | null {
  return value ? value.toString() : null
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
  const plans = row.tierPlans
  if (plans.length === 0) return null

  if (row.visibilityMode === LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY) {
    return plans.find((plan) => plan.tier === LastMinuteTier.DISCOVERY) ?? null
  }

  if (row.visibilityMode === LastMinuteVisibilityMode.PUBLIC_IMMEDIATE) {
    const started = plans.filter((plan) => plan.scheduledFor.getTime() <= now.getTime())
    if (started.length > 0) {
      return started[started.length - 1] ?? null
    }
    return plans[0] ?? null
  }

  return null
}

function incentiveLabel(plan: NonNullable<ReturnType<typeof pickPublicTierPlan>>): string {
  if (plan.offerType === LastMinuteOfferType.PERCENT_OFF && plan.percentOff != null) {
    return `${plan.percentOff}% off`
  }
  if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF && plan.amountOff) {
    return `$${plan.amountOff.toString()} off`
  }
  if (plan.offerType === LastMinuteOfferType.FREE_SERVICE) {
    return 'Free service'
  }
  if (plan.offerType === LastMinuteOfferType.FREE_ADD_ON) {
    return plan.freeAddOnService?.name || 'Free add-on'
  }
  return 'No incentive'
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
      lat: decimalToString(row.location?.lat ?? null),
      lng: decimalToString(row.location?.lng ?? null),
    },

    professional: {
      id: row.professional.id,
      businessName: row.professional.businessName ?? null,
      handle: row.professional.handle ?? null,
      avatarUrl: row.professional.avatarUrl ?? null,
      professionType: row.professional.professionType ?? null,
      locationLabel: row.professional.location ?? null,
    },

    services: row.services.map((serviceRow) => ({
      id: serviceRow.id,
      openingId: serviceRow.openingId,
      serviceId: serviceRow.serviceId,
      offeringId: serviceRow.offeringId,
      sortOrder: serviceRow.sortOrder,
      service: {
        id: serviceRow.service.id,
        name: serviceRow.service.name,
        minPrice: serviceRow.service.minPrice.toString(),
        defaultDurationMinutes: serviceRow.service.defaultDurationMinutes,
      },
      offering: {
        id: serviceRow.offering.id,
        title: serviceRow.offering.title ?? null,
        salonPriceStartingAt: decimalToString(serviceRow.offering.salonPriceStartingAt),
        mobilePriceStartingAt: decimalToString(serviceRow.offering.mobilePriceStartingAt),
        salonDurationMinutes: serviceRow.offering.salonDurationMinutes,
        mobileDurationMinutes: serviceRow.offering.mobileDurationMinutes,
        offersInSalon: serviceRow.offering.offersInSalon,
        offersMobile: serviceRow.offering.offersMobile,
      },
    })),

    publicIncentive: publicPlan
      ? {
          tier: publicPlan.tier,
          offerType: publicPlan.offerType,
          label: incentiveLabel(publicPlan),
          percentOff: publicPlan.percentOff ?? null,
          amountOff: decimalToString(publicPlan.amountOff),
          freeAddOnService: publicPlan.freeAddOnService
            ? {
                id: publicPlan.freeAddOnService.id,
                name: publicPlan.freeAddOnService.name,
              }
            : null,
        }
      : null,
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