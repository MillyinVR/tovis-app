// lib/lastMinute/commands/createLastMinuteOpening.ts
import { prisma } from '@/lib/prisma'
import { pickBookableLocation } from '@/lib/booking/pickLocation'
import {
  getZonedParts,
  isValidIanaTimeZone,
  utcFromDayAndMinutesInTimeZone,
} from '@/lib/timeZone'
import {
  BookingStatus,
  LastMinuteOfferType,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  OpeningStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

type DbClient = Prisma.TransactionClient | typeof prisma

const OPENING_FUTURE_BUFFER_MINUTES = 5
const MAX_SLOT_DURATION_MINUTES = 12 * 60
const MAX_BUFFER_MINUTES = 180
const MAX_OTHER_OVERLAP_MINUTES = MAX_SLOT_DURATION_MINUTES + MAX_BUFFER_MINUTES
const MAX_NOTE_LENGTH = 500

const TIER_ORDER = [
  LastMinuteTier.WAITLIST,
  LastMinuteTier.REACTIVATION,
  LastMinuteTier.DISCOVERY,
] as const

type OrderedTier = (typeof TIER_ORDER)[number]

const openingSelect = {
  id: true,
  professionalId: true,
  locationType: true,
  locationId: true,
  timeZone: true,
  startAt: true,
  endAt: true,
  status: true,
  visibilityMode: true,
  launchAt: true,
  expiresAt: true,
  publicVisibleFrom: true,
  publicVisibleUntil: true,
  bookedAt: true,
  cancelledAt: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  location: {
    select: {
      id: true,
      type: true,
      name: true,
      city: true,
      state: true,
      formattedAddress: true,
      timeZone: true,
      lat: true,
      lng: true,
    },
  },
  services: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      openingId: true,
      serviceId: true,
      offeringId: true,
      sortOrder: true,
      createdAt: true,
      service: {
        select: {
          id: true,
          name: true,
          minPrice: true,
          defaultDurationMinutes: true,
          isAddOnEligible: true,
          addOnGroup: true,
        },
      },
      offering: {
        select: {
          id: true,
          title: true,
          offersInSalon: true,
          offersMobile: true,
          salonPriceStartingAt: true,
          salonDurationMinutes: true,
          mobilePriceStartingAt: true,
          mobileDurationMinutes: true,
        },
      },
    },
  },
    tierPlans: {
    orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
    select: {
      id: true,
      openingId: true,
      tier: true,
      scheduledFor: true,
      processedAt: true,
      cancelledAt: true,
      lastError: true,
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
      createdAt: true,
      updatedAt: true,
    },
  },
  _count: {
    select: {
      recipients: true,
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

export type CreatedLastMinuteOpening = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingSelect
}>

export class CreateLastMinuteOpeningError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'CreateLastMinuteOpeningError'
    this.status = status
    this.code = code
  }
}

export type CreateLastMinuteOpeningTierInput = {
  tier: LastMinuteTier
  offerType?: LastMinuteOfferType | null
  percentOff?: number | null
  amountOff?: Prisma.Decimal | number | string | null
  freeAddOnServiceId?: string | null
}

export type CreateLastMinuteOpeningInput = {
  professionalId: string
  offeringIds: string[]
  startAt: Date
  endAt?: Date | null
  locationType: ServiceLocationType
  requestedLocationId?: string | null
  visibilityMode?: LastMinuteVisibilityMode | null
  note?: string | null
  launchAt?: Date | null
  tierPlans: CreateLastMinuteOpeningTierInput[]
  tx?: DbClient
  now?: Date
}

type LastMinuteSettingsRow = {
  id: string
  enabled: boolean
  minCollectedSubtotal: Prisma.Decimal | null
  defaultVisibilityMode: LastMinuteVisibilityMode
  tier2NightBeforeMinutes: number
  tier3DayOfMinutes: number
  disableMon: boolean
  disableTue: boolean
  disableWed: boolean
  disableThu: boolean
  disableFri: boolean
  disableSat: boolean
  disableSun: boolean
}

type OfferingRow = {
  id: string
  professionalId: string
  serviceId: string
  offersInSalon: boolean
  offersMobile: boolean
  salonPriceStartingAt: Prisma.Decimal | null
  salonDurationMinutes: number | null
  mobilePriceStartingAt: Prisma.Decimal | null
  mobileDurationMinutes: number | null
  service: {
    id: string
    name: string
    minPrice: Prisma.Decimal
    defaultDurationMinutes: number
  }
}

type NormalizedTierPlan = {
  tier: OrderedTier
  offerType: LastMinuteOfferType
  percentOff: number | null
  amountOff: Prisma.Decimal | null
  freeAddOnServiceId: string | null
}

type ScheduledTierPlan = NormalizedTierPlan & {
  scheduledFor: Date
}

function db(tx?: DbClient): DbClient {
  return tx ?? prisma
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) {
    throw new CreateLastMinuteOpeningError(status, code, message)
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}

function parseDecimalOrNull(
  value: Prisma.Decimal | number | string | null | undefined,
): Prisma.Decimal | null {
  if (value == null) return null
  try {
    return new Prisma.Decimal(value)
  } catch {
    return null
  }
}

function parseDate(value: Date): Date {
  const date = new Date(value)
  assert(Number.isFinite(date.getTime()), 400, 'INVALID_START_AT', 'Invalid startAt.')
  return date
}

function parseOptionalEndAt(value: Date | null | undefined): Date | null {
  if (value == null) return null
  const date = new Date(value)
  assert(Number.isFinite(date.getTime()), 400, 'INVALID_END_AT', 'Invalid endAt.')
  return date
}

function validateNote(value: string | null | undefined): string | null {
  const trimmed = cleanOptionalString(value)
  if (!trimmed) return null
  return trimmed.slice(0, MAX_NOTE_LENGTH)
}

function serviceSupportsLocationType(
  offering: OfferingRow,
  locationType: ServiceLocationType,
): boolean {
  return locationType === ServiceLocationType.MOBILE
    ? offering.offersMobile
    : offering.offersInSalon
}

function resolveModeDurationMinutes(
  offering: OfferingRow,
  locationType: ServiceLocationType,
): number {
  const raw =
    locationType === ServiceLocationType.MOBILE
      ? offering.mobileDurationMinutes
      : offering.salonDurationMinutes

  const fallback = offering.service.defaultDurationMinutes || 60
  const picked =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback

  return clampInt(picked, 15, MAX_SLOT_DURATION_MINUTES)
}

function resolveModePrice(
  offering: OfferingRow,
  locationType: ServiceLocationType,
): Prisma.Decimal {
  const raw =
    locationType === ServiceLocationType.MOBILE
      ? offering.mobilePriceStartingAt
      : offering.salonPriceStartingAt

  return raw ?? offering.service.minPrice
}

function weekdayDisabled(args: {
  startAt: Date
  timeZone: string
  settings: LastMinuteSettingsRow
}): boolean {
  const { startAt, timeZone, settings } = args

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(startAt)

  switch (weekday) {
    case 'Mon':
      return settings.disableMon
    case 'Tue':
      return settings.disableTue
    case 'Wed':
      return settings.disableWed
    case 'Thu':
      return settings.disableThu
    case 'Fri':
      return settings.disableFri
    case 'Sat':
      return settings.disableSat
    default:
      return settings.disableSun
  }
}

function tierIndex(tier: LastMinuteTier): number {
  return TIER_ORDER.indexOf(tier as OrderedTier)
}

function sortTierPlansByTier<T extends { tier: LastMinuteTier }>(plans: T[]): T[] {
  return [...plans].sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier))
}

function normalizeTierPlans(
  rawPlans: CreateLastMinuteOpeningTierInput[],
): NormalizedTierPlan[] {
  assert(Array.isArray(rawPlans), 400, 'MISSING_TIER_PLANS', 'tierPlans is required.')

  const byTier = new Map<LastMinuteTier, CreateLastMinuteOpeningTierInput>()
  for (const plan of rawPlans) {
    const tier = plan?.tier
    assert(
      tier === LastMinuteTier.WAITLIST ||
        tier === LastMinuteTier.REACTIVATION ||
        tier === LastMinuteTier.DISCOVERY,
      400,
      'INVALID_TIER',
      'Each tier plan must include a valid tier.',
    )
    assert(!byTier.has(tier), 400, 'DUPLICATE_TIER', `Duplicate tier plan for ${tier}.`)
    byTier.set(tier, plan)
  }

  assert(
    byTier.size === TIER_ORDER.length,
    400,
    'MISSING_TIER',
    'tierPlans must include WAITLIST, REACTIVATION, and DISCOVERY.',
  )

  return TIER_ORDER.map((tier) => {
    const raw = byTier.get(tier)
    assert(raw, 400, 'MISSING_TIER', `Missing tier plan for ${tier}.`)

    const offerType = raw.offerType ?? LastMinuteOfferType.NONE
    const percentOffRaw = raw.percentOff ?? null
    const amountOff = parseDecimalOrNull(raw.amountOff)
    const freeAddOnServiceId = cleanOptionalString(raw.freeAddOnServiceId)

    if (offerType === LastMinuteOfferType.NONE) {
      assert(
        percentOffRaw == null && amountOff == null && freeAddOnServiceId == null,
        400,
        'INVALID_NONE_OFFER',
        `${tier} cannot include extra offer fields when offerType is NONE.`,
      )

      return {
        tier,
        offerType,
        percentOff: null,
        amountOff: null,
        freeAddOnServiceId: null,
      }
    }

    if (offerType === LastMinuteOfferType.PERCENT_OFF) {
      assert(
        amountOff == null && freeAddOnServiceId == null,
        400,
        'INVALID_PERCENT_OFFER',
        `${tier} percent-off plans cannot include amountOff or freeAddOnServiceId.`,
      )

      const percentOff = clampInt(Number(percentOffRaw), 1, 99)
      assert(
        Number.isFinite(Number(percentOffRaw)) &&
          Math.trunc(Number(percentOffRaw)) === percentOff &&
          percentOff >= 1 &&
          percentOff <= 99,
        400,
        'INVALID_PERCENT_OFF',
        `${tier} percentOff must be an integer from 1 to 99.`,
      )

      return {
        tier,
        offerType,
        percentOff,
        amountOff: null,
        freeAddOnServiceId: null,
      }
    }

    if (offerType === LastMinuteOfferType.AMOUNT_OFF) {
      assert(
        percentOffRaw == null && freeAddOnServiceId == null,
        400,
        'INVALID_AMOUNT_OFFER',
        `${tier} amount-off plans cannot include percentOff or freeAddOnServiceId.`,
      )
      assert(amountOff != null, 400, 'INVALID_AMOUNT_OFF', `${tier} amountOff is required.`)
      assert(amountOff.greaterThan(0), 400, 'INVALID_AMOUNT_OFF', `${tier} amountOff must be greater than 0.`)

      return {
        tier,
        offerType,
        percentOff: null,
        amountOff,
        freeAddOnServiceId: null,
      }
    }

    if (offerType === LastMinuteOfferType.FREE_SERVICE) {
      assert(
        percentOffRaw == null && amountOff == null && freeAddOnServiceId == null,
        400,
        'INVALID_FREE_SERVICE',
        `${tier} free-service plans cannot include percentOff, amountOff, or freeAddOnServiceId.`,
      )

      return {
        tier,
        offerType,
        percentOff: null,
        amountOff: null,
        freeAddOnServiceId: null,
      }
    }

    assert(
      offerType === LastMinuteOfferType.FREE_ADD_ON,
      400,
      'INVALID_OFFER_TYPE',
      `${tier} has an invalid offer type.`,
    )

    assert(
      percentOffRaw == null && amountOff == null,
      400,
      'INVALID_FREE_ADD_ON',
      `${tier} free add-on plans cannot include percentOff or amountOff.`,
    )
    assert(
      freeAddOnServiceId,
      400,
      'MISSING_FREE_ADD_ON_SERVICE',
      `${tier} free add-on plans must include freeAddOnServiceId.`,
    )

    return {
      tier,
      offerType,
      percentOff: null,
      amountOff: null,
      freeAddOnServiceId,
    }
  })
}

function buildStandardTierSchedule(args: {
  openingStartAt: Date
  openingTimeZone: string
  tier2NightBeforeMinutes: number
  tier3DayOfMinutes: number
}): Record<OrderedTier, Date> {
  const {
    openingStartAt,
    openingTimeZone,
    tier2NightBeforeMinutes,
    tier3DayOfMinutes,
  } = args

  const waitlistAt = new Date(openingStartAt.getTime() - 24 * 60 * 60_000)
  const reactivationDesired = utcFromDayAndMinutesInTimeZone(
    new Date(openingStartAt.getTime() - 24 * 60 * 60_000),
    tier2NightBeforeMinutes,
    openingTimeZone,
  )
  const discoveryDesired = utcFromDayAndMinutesInTimeZone(
    openingStartAt,
    tier3DayOfMinutes,
    openingTimeZone,
  )

  const reactivationAt = new Date(
    Math.max(reactivationDesired.getTime(), waitlistAt.getTime() + 60_000),
  )
  const discoveryAt = new Date(
    Math.max(discoveryDesired.getTime(), reactivationAt.getTime() + 60_000),
  )

  return {
    [LastMinuteTier.WAITLIST]: waitlistAt,
    [LastMinuteTier.REACTIVATION]: reactivationAt,
    [LastMinuteTier.DISCOVERY]: discoveryAt,
  }
}

function buildCompressedTierSchedule(args: {
  tiers: OrderedTier[]
  launchAt: Date
  openingStartAt: Date
}): Record<OrderedTier, Date> {
  const { tiers, launchAt, openingStartAt } = args
  const spanMs = openingStartAt.getTime() - launchAt.getTime()

  assert(
    spanMs > 0,
    400,
    'OPENING_ALREADY_STARTED',
    'Not enough time remains to schedule a last-minute rollout before the opening starts.',
  )

  const stepMs = spanMs / (tiers.length + 1)

  const result = {} as Record<OrderedTier, Date>
  tiers.forEach((tier, index) => {
    result[tier] = new Date(launchAt.getTime() + stepMs * (index + 1))
  })

  return result
}

function scheduleTierPlans(args: {
  plans: NormalizedTierPlan[]
  openingStartAt: Date
  openingTimeZone: string
  launchAt: Date
  settings: LastMinuteSettingsRow
}): ScheduledTierPlan[] {
  const { plans, openingStartAt, openingTimeZone, launchAt, settings } = args

  const orderedPlans = sortTierPlansByTier(plans)
  const orderedTiers = orderedPlans.map((plan) => plan.tier as OrderedTier)

  const standardSchedule = buildStandardTierSchedule({
    openingStartAt,
    openingTimeZone,
    tier2NightBeforeMinutes: settings.tier2NightBeforeMinutes,
    tier3DayOfMinutes: settings.tier3DayOfMinutes,
  })

  const shouldCompress = orderedTiers.some((tier) => {
    const scheduledFor = standardSchedule[tier]
    return scheduledFor.getTime() <= launchAt.getTime() || scheduledFor.getTime() >= openingStartAt.getTime()
  })

  const scheduleByTier = shouldCompress
    ? buildCompressedTierSchedule({
        tiers: orderedTiers,
        launchAt,
        openingStartAt,
      })
    : standardSchedule

  return orderedPlans.map((plan) => ({
    ...plan,
    scheduledFor: scheduleByTier[plan.tier as OrderedTier],
  }))
}

function resolvePublicVisibleFrom(args: {
  visibilityMode: LastMinuteVisibilityMode
  launchAt: Date
  scheduledPlans: ScheduledTierPlan[]
}): Date | null {
  const { visibilityMode, launchAt, scheduledPlans } = args

  if (visibilityMode === LastMinuteVisibilityMode.PUBLIC_IMMEDIATE) {
    return launchAt
  }

  if (visibilityMode === LastMinuteVisibilityMode.TARGETED_ONLY) {
    return null
  }

  const discoveryPlan = scheduledPlans.find((plan) => plan.tier === LastMinuteTier.DISCOVERY)
  assert(
    discoveryPlan,
    400,
    'MISSING_DISCOVERY_PLAN',
    'PUBLIC_AT_DISCOVERY visibility requires a DISCOVERY tier plan.',
  )

  return discoveryPlan.scheduledFor
}

async function validateFreeAddOnPlans(args: {
  db: DbClient
  plans: NormalizedTierPlan[]
  offerings: OfferingRow[]
}): Promise<void> {
  const { db: database, plans, offerings } = args

  const freeAddOnServiceIds = Array.from(
    new Set(
      plans
        .map((plan) => plan.freeAddOnServiceId)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )

  if (freeAddOnServiceIds.length === 0) {
    return
  }

  const offeringIds = offerings.map((offering) => offering.id)

  const freeAddOnServices = await database.service.findMany({
    where: {
      id: { in: freeAddOnServiceIds },
    },
    select: {
      id: true,
      isAddOnEligible: true,
    },
  })

  const eligibleAddOnIds = new Set(
    freeAddOnServices
      .filter((service) => service.isAddOnEligible)
      .map((service) => service.id),
  )

  for (const plan of plans) {
    if (plan.offerType !== LastMinuteOfferType.FREE_ADD_ON) continue

    assert(
      plan.freeAddOnServiceId && eligibleAddOnIds.has(plan.freeAddOnServiceId),
      400,
      'INVALID_FREE_ADD_ON_SERVICE',
      `${plan.tier} free add-on service must exist and be add-on eligible.`,
    )
  }

  const links = await database.offeringAddOn.findMany({
    where: {
      offeringId: { in: offeringIds },
      addOnServiceId: { in: freeAddOnServiceIds },
      isActive: true,
    },
    select: {
      offeringId: true,
      addOnServiceId: true,
    },
  })

  const activeLinkSet = new Set(
    links.map((link) => `${link.offeringId}:${link.addOnServiceId}`),
  )

  for (const plan of plans) {
    if (plan.offerType !== LastMinuteOfferType.FREE_ADD_ON) continue

    const addOnServiceId = plan.freeAddOnServiceId
    assert(
      addOnServiceId,
      400,
      'MISSING_FREE_ADD_ON_SERVICE',
      `${plan.tier} requires freeAddOnServiceId.`,
    )

    for (const offering of offerings) {
      const key = `${offering.id}:${addOnServiceId}`
      assert(
        activeLinkSet.has(key),
        400,
        'FREE_ADD_ON_NOT_SUPPORTED',
        `${plan.tier} free add-on must be supported by every selected offering.`,
      )
    }
  }
}

function validateOfferFloors(args: {
  plans: NormalizedTierPlan[]
  offerings: OfferingRow[]
  locationType: ServiceLocationType
  serviceRuleFloorByServiceId: Map<string, Prisma.Decimal | null>
  globalFloor: Prisma.Decimal | null
}): void {
  const {
    plans,
    offerings,
    locationType,
    serviceRuleFloorByServiceId,
    globalFloor,
  } = args

  for (const plan of plans) {
    if (
      plan.offerType !== LastMinuteOfferType.PERCENT_OFF &&
      plan.offerType !== LastMinuteOfferType.AMOUNT_OFF
    ) {
      continue
    }

    for (const offering of offerings) {
      const basePrice = resolveModePrice(offering, locationType)
      const serviceFloor = serviceRuleFloorByServiceId.get(offering.serviceId) ?? null
      const effectiveFloor = serviceFloor ?? globalFloor

      if (plan.offerType === LastMinuteOfferType.PERCENT_OFF) {
        assert(plan.percentOff != null, 400, 'MISSING_PERCENT_OFF', `${plan.tier} percentOff is required.`)

        const discounted = basePrice.mul(new Prisma.Decimal(100 - plan.percentOff)).div(100)
        assert(
          discounted.greaterThan(0),
          400,
          'INVALID_PERCENT_OFF',
          `${plan.tier} percentOff would reduce at least one selected service below zero.`,
        )

        if (effectiveFloor) {
          assert(
            discounted.greaterThanOrEqualTo(effectiveFloor),
            400,
            'MIN_COLLECTED_SUBTOTAL_VIOLATION',
            `${plan.tier} percentOff would reduce ${offering.service.name} below its minimum collected subtotal.`,
          )
        }
      }

      if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF) {
        assert(plan.amountOff != null, 400, 'MISSING_AMOUNT_OFF', `${plan.tier} amountOff is required.`)

        assert(
          plan.amountOff.lessThan(basePrice),
          400,
          'INVALID_AMOUNT_OFF',
          `${plan.tier} amountOff must be less than the selected service price. Use FREE_SERVICE instead.`,
        )

        const discounted = basePrice.minus(plan.amountOff)
        if (effectiveFloor) {
          assert(
            discounted.greaterThanOrEqualTo(effectiveFloor),
            400,
            'MIN_COLLECTED_SUBTOTAL_VIOLATION',
            `${plan.tier} amountOff would reduce ${offering.service.name} below its minimum collected subtotal.`,
          )
        }
      }
    }
  }
}

async function fetchOfferings(args: {
  db: DbClient
  professionalId: string
  offeringIds: string[]
}): Promise<OfferingRow[]> {
  const { db: database, professionalId, offeringIds } = args

  const offerings = await database.professionalServiceOffering.findMany({
    where: {
      id: { in: offeringIds },
      professionalId,
      isActive: true,
    },
    select: {
      id: true,
      professionalId: true,
      serviceId: true,
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: true,
      salonDurationMinutes: true,
      mobilePriceStartingAt: true,
      mobileDurationMinutes: true,
      service: {
        select: {
          id: true,
          name: true,
          minPrice: true,
          defaultDurationMinutes: true,
        },
      },
    },
  })

  assert(
    offerings.length === offeringIds.length,
    404,
    'OFFERING_NOT_FOUND',
    'One or more selected offerings were not found or are inactive.',
  )

  return offerings
}

async function createInsideTransaction(args: {
  db: DbClient
  professionalId: string
  offeringIds: string[]
  startAt: Date
  endAt: Date | null
  locationType: ServiceLocationType
  requestedLocationId: string | null
  visibilityMode: LastMinuteVisibilityMode | null
  note: string | null
  launchAt: Date | null
  tierPlans: CreateLastMinuteOpeningTierInput[]
  now: Date
}): Promise<CreatedLastMinuteOpening> {
  const {
    db: database,
    professionalId,
    offeringIds,
    startAt,
    endAt,
    locationType,
    requestedLocationId,
    visibilityMode,
    note,
    launchAt,
    tierPlans,
    now,
  } = args

  const settings = await database.lastMinuteSettings.findUnique({
    where: { professionalId },
    select: {
      id: true,
      enabled: true,
      minCollectedSubtotal: true,
      defaultVisibilityMode: true,
      tier2NightBeforeMinutes: true,
      tier3DayOfMinutes: true,
      disableMon: true,
      disableTue: true,
      disableWed: true,
      disableThu: true,
      disableFri: true,
      disableSat: true,
      disableSun: true,
    },
  })

  assert(settings, 409, 'LAST_MINUTE_SETTINGS_REQUIRED', 'Configure last-minute settings before creating openings.')
  assert(settings.enabled, 409, 'LAST_MINUTE_DISABLED', 'Last-minute openings are disabled for this professional.')

  const pickedVisibilityMode = visibilityMode ?? settings.defaultVisibilityMode

  const location = await pickBookableLocation({
    tx: database,
    professionalId,
    requestedLocationId,
    locationType,
  })

  assert(location, 409, 'BOOKABLE_LOCATION_REQUIRED', 'No bookable location found for this opening.')
  assert(
    isValidIanaTimeZone(location.timeZone),
    409,
    'TIMEZONE_REQUIRED',
    'This location is missing a valid timezone. Set a valid timezone before creating openings.',
  )

  const openingTimeZone = location.timeZone as string

  assert(
    startAt.getTime() >= addMinutes(now, OPENING_FUTURE_BUFFER_MINUTES).getTime(),
    400,
    'START_AT_TOO_SOON',
    'Please choose a future time.',
  )

  assert(
    !weekdayDisabled({
      startAt,
      timeZone: openingTimeZone,
      settings,
    }),
    409,
    'LAST_MINUTE_DISABLED_FOR_DAY',
    'Last-minute openings are disabled for that day.',
  )

  const offerings = await fetchOfferings({
    db: database,
    professionalId,
    offeringIds,
  })

  for (const offering of offerings) {
    assert(
      serviceSupportsLocationType(offering, locationType),
      400,
      'LOCATION_TYPE_NOT_SUPPORTED',
      `${offering.service.name} does not support ${locationType.toLowerCase()} openings.`,
    )
  }

  const longestDurationMinutes = offerings.reduce((max, offering) => {
    const duration = resolveModeDurationMinutes(offering, locationType)
    return Math.max(max, duration)
  }, 15)

  const minimumEndAt = addMinutes(startAt, longestDurationMinutes)
  const finalEndAt = endAt ?? minimumEndAt

  assert(
    finalEndAt.getTime() > startAt.getTime(),
    400,
    'INVALID_END_AT',
    'End must be after start.',
  )

  assert(
    finalEndAt.getTime() >= minimumEndAt.getTime(),
    400,
    'END_AT_TOO_SHORT',
    `End must allow at least ${longestDurationMinutes} minutes for the selected services.`,
  )

  const launchBase = launchAt ?? now
  assert(
    launchBase.getTime() < startAt.getTime(),
    400,
    'INVALID_LAUNCH_AT',
    'launchAt must be before the opening start time.',
  )

  const normalizedPlans = normalizeTierPlans(tierPlans)

  const serviceRules = await database.lastMinuteServiceRule.findMany({
    where: {
      settingsId: settings.id,
      serviceId: { in: offerings.map((offering) => offering.serviceId) },
    },
    select: {
      serviceId: true,
      enabled: true,
      minCollectedSubtotal: true,
    },
  })

  const ruleByServiceId = new Map(
    serviceRules.map((rule) => [rule.serviceId, rule]),
  )

  for (const offering of offerings) {
    const rule = ruleByServiceId.get(offering.serviceId)
    if (rule) {
      assert(
        rule.enabled,
        409,
        'SERVICE_NOT_ELIGIBLE',
        `${offering.service.name} is disabled for last-minute openings.`,
      )
    }
  }

  await validateFreeAddOnPlans({
    db: database,
    plans: normalizedPlans,
    offerings,
  })

  validateOfferFloors({
    plans: normalizedPlans,
    offerings,
    locationType,
    serviceRuleFloorByServiceId: new Map(
      serviceRules.map((rule) => [rule.serviceId, rule.minCollectedSubtotal ?? null]),
    ),
    globalFloor: settings.minCollectedSubtotal,
  })

  const scheduledPlans = scheduleTierPlans({
    plans: normalizedPlans,
    openingStartAt: startAt,
    openingTimeZone,
    launchAt: launchBase,
    settings,
  })

  const publicVisibleFrom = resolvePublicVisibleFrom({
    visibilityMode: pickedVisibilityMode,
    launchAt: launchBase,
    scheduledPlans,
  })

  const overlapOpening = await database.lastMinuteOpening.findFirst({
    where: {
      professionalId,
      status: OpeningStatus.ACTIVE,
      cancelledAt: null,
      startAt: { lt: finalEndAt },
      OR: [{ endAt: null }, { endAt: { gt: startAt } }],
    },
    select: { id: true },
  })

  assert(
    !overlapOpening,
    409,
    'OPENING_OVERLAP',
    'You already have an active opening overlapping that time.',
  )

  const calendarBlock = await database.calendarBlock.findFirst({
    where: {
      professionalId,
      startsAt: { lt: finalEndAt },
      endsAt: { gt: startAt },
      OR: [{ locationId: location.id }, { locationId: null }],
    },
    select: { id: true },
  })

  assert(!calendarBlock, 409, 'CALENDAR_BLOCK_CONFLICT', 'That time is blocked.')

  const lastMinuteBlock = await database.lastMinuteBlock.findFirst({
    where: {
      settingsId: settings.id,
      startAt: { lt: finalEndAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  })

  assert(
    !lastMinuteBlock,
    409,
    'LAST_MINUTE_BLOCK_CONFLICT',
    'That time overlaps a last-minute block.',
  )

  const earliestStart = addMinutes(startAt, -MAX_OTHER_OVERLAP_MINUTES)

  const nearbyBookings = await database.booking.findMany({
    where: {
      professionalId,
      status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED] },
      scheduledFor: { gte: earliestStart, lt: finalEndAt },
    },
    select: {
      scheduledFor: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
    },
    take: 2000,
  })

  const overlapsBooking = nearbyBookings.some((booking) => {
    const bookingStart = booking.scheduledFor
    const bookingDuration = clampInt(
      Number(booking.totalDurationMinutes ?? 0) || 60,
      15,
      MAX_SLOT_DURATION_MINUTES,
    )
    const bookingBuffer = clampInt(
      Number(booking.bufferMinutes ?? 0) || 0,
      0,
      MAX_BUFFER_MINUTES,
    )
    const bookingEnd = addMinutes(bookingStart, bookingDuration + bookingBuffer)
    return overlaps(startAt, finalEndAt, bookingStart, bookingEnd)
  })

  assert(!overlapsBooking, 409, 'BOOKING_CONFLICT', 'That time overlaps an existing booking.')

  const activeHolds = await database.bookingHold.findMany({
    where: {
      professionalId,
      expiresAt: { gt: now },
      scheduledFor: { gte: earliestStart, lt: finalEndAt },
    },
    select: {
      id: true,
      offeringId: true,
      locationId: true,
      locationType: true,
      scheduledFor: true,
    },
    take: 2000,
  })

  if (activeHolds.length > 0) {
    const holdOfferingIds = Array.from(new Set(activeHolds.map((hold) => hold.offeringId)))

    const holdOfferings = holdOfferingIds.length
      ? await database.professionalServiceOffering.findMany({
          where: { id: { in: holdOfferingIds } },
          select: {
            id: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
          take: 2000,
        })
      : []

    const holdOfferingById = new Map(holdOfferings.map((row) => [row.id, row]))

    const holdLocationIds = Array.from(
      new Set(
        activeHolds
          .map((hold) => hold.locationId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    )

    const holdLocations = holdLocationIds.length
      ? await database.professionalLocation.findMany({
          where: { id: { in: holdLocationIds } },
          select: {
            id: true,
            bufferMinutes: true,
          },
          take: 2000,
        })
      : []

    const holdBufferByLocationId = new Map(
      holdLocations.map((row) => [
        row.id,
        clampInt(Number(row.bufferMinutes ?? 0) || 0, 0, MAX_BUFFER_MINUTES),
      ]),
    )

    const overlapsHold = activeHolds.some((hold) => {
      const holdOffering = holdOfferingById.get(hold.offeringId)
      const rawDuration =
        hold.locationType === ServiceLocationType.MOBILE
          ? holdOffering?.mobileDurationMinutes ?? null
          : holdOffering?.salonDurationMinutes ?? null

      const holdDuration = clampInt(Number(rawDuration ?? 0) || 60, 15, MAX_SLOT_DURATION_MINUTES)
      const holdBuffer = holdBufferByLocationId.get(hold.locationId) ?? 0
      const holdEnd = addMinutes(hold.scheduledFor, holdDuration + holdBuffer)

      return overlaps(startAt, finalEndAt, hold.scheduledFor, holdEnd)
    })

    assert(
      !overlapsHold,
      409,
      'HOLD_CONFLICT',
      'That time is currently being held by a client.',
    )
  }

  const created = await database.lastMinuteOpening.create({
    data: {
      professionalId,
      locationType,
      locationId: location.id,
      timeZone: openingTimeZone,
      startAt,
      endAt: finalEndAt,
      status: OpeningStatus.ACTIVE,
      visibilityMode: pickedVisibilityMode,
      launchAt: launchBase,
      expiresAt: finalEndAt,
      publicVisibleFrom,
      publicVisibleUntil: finalEndAt,
      note,
    },
    select: { id: true },
  })

  await database.lastMinuteOpeningService.createMany({
    data: offerings.map((offering, index) => ({
      openingId: created.id,
      serviceId: offering.serviceId,
      offeringId: offering.id,
      sortOrder: index,
    })),
  })

  await database.lastMinuteTierPlan.createMany({
    data: scheduledPlans.map((plan) => ({
      openingId: created.id,
      tier: plan.tier,
      scheduledFor: plan.scheduledFor,
      offerType: plan.offerType,
      percentOff: plan.percentOff,
      amountOff: plan.amountOff,
      freeAddOnServiceId: plan.freeAddOnServiceId,
    })),
  })

  const fullOpening = await database.lastMinuteOpening.findUnique({
    where: { id: created.id },
    select: openingSelect,
  })

  assert(fullOpening, 500, 'OPENING_CREATE_FAILED', 'Failed to load created last-minute opening.')
  return fullOpening
}

export async function createLastMinuteOpening(
  input: CreateLastMinuteOpeningInput,
): Promise<CreatedLastMinuteOpening> {
  const professionalId = cleanId(input.professionalId)
  const offeringIds = Array.from(
    new Set(input.offeringIds.map((value) => cleanId(value)).filter(Boolean)),
  )
  const requestedLocationId = cleanOptionalString(input.requestedLocationId)
  const note = validateNote(input.note)
  const startAt = parseDate(input.startAt)
  const endAt = parseOptionalEndAt(input.endAt)
  const launchAt = input.launchAt ? parseDate(input.launchAt) : null
  const now = input.now ? parseDate(input.now) : new Date()

  assert(professionalId, 400, 'MISSING_PROFESSIONAL_ID', 'Missing professionalId.')
  assert(offeringIds.length > 0, 400, 'MISSING_OFFERINGS', 'Select at least one offering.')

  const database = db(input.tx)

  if (input.tx) {
    return createInsideTransaction({
      db: database,
      professionalId,
      offeringIds,
      startAt,
      endAt,
      locationType: input.locationType,
      requestedLocationId,
      visibilityMode: input.visibilityMode ?? null,
      note,
      launchAt,
      tierPlans: input.tierPlans,
      now,
    })
  }

  return prisma.$transaction((tx) =>
    createInsideTransaction({
      db: tx,
      professionalId,
      offeringIds,
      startAt,
      endAt,
      locationType: input.locationType,
      requestedLocationId,
      visibilityMode: input.visibilityMode ?? null,
      note,
      launchAt,
      tierPlans: input.tierPlans,
      now,
    }),
  )
}