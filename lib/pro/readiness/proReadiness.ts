// lib/pro/readiness/proReadiness.ts
//
// Evaluates whether a professional is "live" and bookable.
// Used by: dashboard banners, profile publishing, discovery/search filters,
// availability bootstrap/day routes, and booking mutation gates.
//

import {
  Prisma,
  ProfessionalLocationType,
  StripeAccountStatus,
  VerificationStatus,
} from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'

// ─── Public types ─────────────────────────────────────────────────────────────

export type LiveBookingMode = 'SALON' | 'MOBILE'

export type ProBookingEntryPoint =
  | 'BROAD_DISCOVERY'
  | 'SPECIFIC_SEARCH'
  | 'DIRECT_PROFILE'
  | 'NFC_CARD'
  | 'SHORT_CODE'
  | 'QR_CODE'
  | 'AFTERCARE_REBOOK'
  | 'SALON_WHITE_LABEL'
  | 'PRO_CREATED'

export type ProReadinessBlocker =
  | 'NO_ACTIVE_OFFERING'
  | 'NO_BOOKABLE_LOCATION'
  | 'SALON_MISSING_ADDRESS'
  | 'MOBILE_MISSING_BASE_CONFIG'
  | 'LOCATION_MISSING_TIMEZONE'
  | 'LOCATION_MISSING_WORKING_HOURS'
  | 'LOCATION_MISSING_GEO'
  | 'OFFERING_MISSING_SALON_PRICE_OR_DURATION'
  | 'OFFERING_MISSING_MOBILE_PRICE_OR_DURATION'
  | 'STRIPE_NOT_READY'
  | 'VERIFICATION_NOT_APPROVED'
  | 'VERIFICATION_NOT_BROADLY_DISCOVERABLE'

export type ProReadiness =
  | { ok: true; liveModes: LiveBookingMode[]; readyLocationIds: string[] }
  | { ok: false; blockers: ProReadinessBlocker[] }

export type PublishableLocationBlocker =
  | 'LOCATION_MISSING_TIMEZONE'
  | 'LOCATION_MISSING_WORKING_HOURS'
  | 'SALON_MISSING_ADDRESS'

export type PublishableLocationReadiness =
  | { ok: true; locationId: string }
  | {
      ok: false
      locationId: string
      blockers: PublishableLocationBlocker[]
    }

// ─── Internal data ────────────────────────────────────────────────────────────

const proReadinessSelect = {
  id: true,
  mobileRadiusMiles: true,
  mobileBasePostalCode: true,
  verificationStatus: true,
  paymentSettings: {
    select: {
      acceptStripeCard: true,
      stripeAccountStatus: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  },
  locations: {
    select: {
      id: true,
      type: true,
      formattedAddress: true,
      lat: true,
      lng: true,
      timeZone: true,
      workingHours: true,
      isBookable: true,
    },
  },
  offerings: {
    where: { isActive: true },
    select: {
      id: true,
      offersInSalon: true,
      offersMobile: true,
      salonPriceStartingAt: true,
      salonDurationMinutes: true,
      mobilePriceStartingAt: true,
      mobileDurationMinutes: true,
    },
  },
} as const

// ─── Working hours check ──────────────────────────────────────────────────────

type WorkingDay = {
  enabled?: boolean
  start?: string
  end?: string
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function isWorkingDay(value: unknown): value is WorkingDay {
  if (!isRecord(value)) return false

  const enabled = value.enabled
  const start = value.start
  const end = value.end

  return (
    (enabled === undefined || typeof enabled === 'boolean') &&
    (start === undefined || typeof start === 'string') &&
    (end === undefined || typeof end === 'string')
  )
}

function isValidWorkingHours(raw: unknown): boolean {
  if (!isRecord(raw)) return false

  for (const day of DAY_KEYS) {
    if (!(day in raw)) return false
  }

  return DAY_KEYS.some((day) => {
    const value = raw[day]

    if (!isWorkingDay(value)) return false

    return (
      value.enabled === true &&
      typeof value.start === 'string' &&
      typeof value.end === 'string' &&
      value.start.trim().length > 0 &&
      value.end.trim().length > 0
    )
  })
}

// ─── Core evaluation ──────────────────────────────────────────────────────────

type ProReadinessRecord = Prisma.ProfessionalProfileGetPayload<{
  select: typeof proReadinessSelect
}>

type ProReadinessDb = Pick<Prisma.TransactionClient, 'professionalProfile'>

function isSalonLikeLocation(type: ProfessionalLocationType): boolean {
  return (
    type === ProfessionalLocationType.SALON ||
    type === ProfessionalLocationType.SUITE
  )
}

function isBlockedVerificationStatus(status: VerificationStatus): boolean {
  return (
    status === VerificationStatus.REJECTED ||
    status === VerificationStatus.NEEDS_INFO
  )
}

function isBroadlyDiscoverableVerificationStatus(
  status: VerificationStatus,
): boolean {
  return status === VerificationStatus.APPROVED
}

function requiresBroadDiscoveryApproval(
  entryPoint: ProBookingEntryPoint,
): boolean {
  return entryPoint === 'BROAD_DISCOVERY'
}

function addBlocker(
  blockers: Set<ProReadinessBlocker>,
  blocker: ProReadinessBlocker,
): void {
  blockers.add(blocker)
}

export function evaluatePublishableLocation(
  location: Pick<
    ProReadinessRecord['locations'][number],
    'id' | 'type' | 'formattedAddress' | 'timeZone' | 'workingHours'
  >,
): PublishableLocationReadiness {
  const blockers = new Set<PublishableLocationBlocker>()

  if (!location.timeZone || !isValidIanaTimeZone(location.timeZone)) {
    blockers.add('LOCATION_MISSING_TIMEZONE')
  }

  if (!isValidWorkingHours(location.workingHours)) {
    blockers.add('LOCATION_MISSING_WORKING_HOURS')
  }

  if (isSalonLikeLocation(location.type) && !location.formattedAddress) {
    blockers.add('SALON_MISSING_ADDRESS')
  }

  if (blockers.size > 0) {
    return {
      ok: false,
      locationId: location.id,
      blockers: [...blockers],
    }
  }

  return {
    ok: true,
    locationId: location.id,
  }
}

function hasReadyStripeConnect(
  paymentSettings: ProReadinessRecord['paymentSettings'],
): boolean {
  if (!paymentSettings?.acceptStripeCard) return true

  return (
    paymentSettings.stripeAccountStatus === StripeAccountStatus.ENABLED &&
    paymentSettings.stripeChargesEnabled &&
    paymentSettings.stripePayoutsEnabled &&
    paymentSettings.stripeDetailsSubmitted
  )
}

function evaluateProReadinessForEntryPoint(args: {
  pro: ProReadinessRecord
  entryPoint: ProBookingEntryPoint
}): ProReadiness {
  const { pro, entryPoint } = args
  const blockers = new Set<ProReadinessBlocker>()

  // ── Verification ──────────────────────────────────────────────────────────
  // REJECTED and NEEDS_INFO block every booking entry point.
  // PENDING/manual-review style states are allowed for intentional booking
  // paths, but not for broad discovery.
  if (isBlockedVerificationStatus(pro.verificationStatus)) {
    addBlocker(blockers, 'VERIFICATION_NOT_APPROVED')
  }

  if (
    requiresBroadDiscoveryApproval(entryPoint) &&
    !isBroadlyDiscoverableVerificationStatus(pro.verificationStatus)
  ) {
    addBlocker(blockers, 'VERIFICATION_NOT_BROADLY_DISCOVERABLE')
  }

  // ── Offerings ─────────────────────────────────────────────────────────────
  const activeOfferings = pro.offerings ?? []

  if (activeOfferings.length === 0) {
    addBlocker(blockers, 'NO_ACTIVE_OFFERING')
  }

  // ── Locations ─────────────────────────────────────────────────────────────
  // Booking readiness is based only on locations explicitly marked bookable.
  // Draft/unbookable locations should neither make a Pro bookable nor block an
  // otherwise valid bookable location.
  const allLocations = pro.locations ?? []
  const bookableLocations = allLocations.filter((location) =>
    Boolean(location.isBookable),
  )

  if (bookableLocations.length === 0) {
    addBlocker(blockers, 'NO_BOOKABLE_LOCATION')
  }

  const anyMissingTimezone = bookableLocations.some(
    (location) =>
      !location.timeZone || !isValidIanaTimeZone(location.timeZone),
  )

  if (anyMissingTimezone) {
    addBlocker(blockers, 'LOCATION_MISSING_TIMEZONE')
  }

  const anyMissingWorkingHours = bookableLocations.some(
    (location) => !isValidWorkingHours(location.workingHours),
  )

  if (anyMissingWorkingHours) {
    addBlocker(blockers, 'LOCATION_MISSING_WORKING_HOURS')
  }

  const bookableSalonLocations = bookableLocations.filter((location) =>
    isSalonLikeLocation(location.type),
  )

  const anyMissingGeo = bookableLocations.some(
    (location) => location.lat == null || location.lng == null,
  )

  if (anyMissingGeo) {
    addBlocker(blockers, 'LOCATION_MISSING_GEO')
  }

  const anySalonMissingAddress = bookableSalonLocations.some(
    (location) => !location.formattedAddress,
  )

  if (anySalonMissingAddress) {
    addBlocker(blockers, 'SALON_MISSING_ADDRESS')
  }

  const bookableMobileLocation = bookableLocations.find(
    (location) => location.type === ProfessionalLocationType.MOBILE_BASE,
  )

  if (bookableMobileLocation) {
    const hasMobileBase =
      Boolean(pro.mobileBasePostalCode) && Boolean(pro.mobileRadiusMiles)

    if (!hasMobileBase) {
      addBlocker(blockers, 'MOBILE_MISSING_BASE_CONFIG')
    }
  }

  const readyLocationIds = bookableLocations
    .filter((location) => {
      const hasTimezone =
        Boolean(location.timeZone) && isValidIanaTimeZone(location.timeZone)
      const hasWorkingHours = isValidWorkingHours(location.workingHours)
      const hasGeo = location.lat != null && location.lng != null
      const hasSalonAddress =
        !isSalonLikeLocation(location.type) ||
        Boolean(location.formattedAddress)

      return hasTimezone && hasWorkingHours && hasGeo && hasSalonAddress
    })
    .map((location) => location.id)

  if (readyLocationIds.length === 0 && bookableLocations.length > 0) {
    addBlocker(blockers, 'NO_BOOKABLE_LOCATION')
  }

  const readyLocationIdSet = new Set(readyLocationIds)

  const readyBookableLocations = bookableLocations.filter((location) =>
    readyLocationIdSet.has(location.id),
  )

  const salonLocations = readyBookableLocations.filter((location) =>
    isSalonLikeLocation(location.type),
  )

  const mobileLocation = readyBookableLocations.find(
    (location) => location.type === ProfessionalLocationType.MOBILE_BASE,
  )

  // ── Payment readiness ─────────────────────────────────────────────────────
  if (!hasReadyStripeConnect(pro.paymentSettings)) {
    addBlocker(blockers, 'STRIPE_NOT_READY')
  }

  // ── Offering price/duration checks per mode ───────────────────────────────
  if (activeOfferings.length > 0) {
    const hasSalonMode = salonLocations.length > 0
    const hasMobileMode = Boolean(mobileLocation)

    if (hasSalonMode) {
      const missingSalon = activeOfferings
        .filter((offering) => offering.offersInSalon)
        .some(
          (offering) =>
            offering.salonPriceStartingAt == null ||
            offering.salonDurationMinutes == null,
        )

      if (missingSalon) {
        addBlocker(blockers, 'OFFERING_MISSING_SALON_PRICE_OR_DURATION')
      }
    }

    if (hasMobileMode) {
      const missingMobile = activeOfferings
        .filter((offering) => offering.offersMobile)
        .some(
          (offering) =>
            offering.mobilePriceStartingAt == null ||
            offering.mobileDurationMinutes == null,
        )

      if (missingMobile) {
        addBlocker(blockers, 'OFFERING_MISSING_MOBILE_PRICE_OR_DURATION')
      }
    }
  }

  if (blockers.size > 0) {
    return { ok: false, blockers: [...blockers] }
  }

  // ── Determine live modes ──────────────────────────────────────────────────
  const liveModes: LiveBookingMode[] = []

  if (
    salonLocations.length > 0 &&
    activeOfferings.some((offering) => offering.offersInSalon)
  ) {
    liveModes.push('SALON')
  }

  if (
    mobileLocation &&
    activeOfferings.some((offering) => offering.offersMobile)
  ) {
    liveModes.push('MOBILE')
  }

  if (liveModes.length === 0) {
    return {
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    }
  }

  return { ok: true, liveModes, readyLocationIds }
}

function evaluateProReadiness(pro: ProReadinessRecord): ProReadiness {
  return evaluateProReadinessForEntryPoint({
    pro,
    entryPoint: 'SPECIFIC_SEARCH',
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkProReadinessWithDb(args: {
  db: ProReadinessDb
  professionalId: string
}): Promise<ProReadiness> {
  const pro = await args.db.professionalProfile.findUnique({
    where: { id: args.professionalId },
    select: proReadinessSelect,
  })

  if (!pro) {
    return { ok: false, blockers: ['NO_BOOKABLE_LOCATION'] }
  }

  return evaluateProReadiness(pro)
}

export async function checkProReadinessForEntryPointWithDb(args: {
  db: ProReadinessDb
  professionalId: string
  entryPoint: ProBookingEntryPoint
}): Promise<ProReadiness> {
  const pro = await args.db.professionalProfile.findUnique({
    where: { id: args.professionalId },
    select: proReadinessSelect,
  })

  if (!pro) {
    return { ok: false, blockers: ['NO_BOOKABLE_LOCATION'] }
  }

  return evaluateProReadinessForEntryPoint({
    pro,
    entryPoint: args.entryPoint,
  })
}

export async function checkProReadiness(
  professionalId: string,
): Promise<ProReadiness> {
  return checkProReadinessWithDb({
    db: prisma,
    professionalId,
  })
}

export async function checkProReadinessForEntryPoint(args: {
  professionalId: string
  entryPoint: ProBookingEntryPoint
}): Promise<ProReadiness> {
  return checkProReadinessForEntryPointWithDb({
    db: prisma,
    professionalId: args.professionalId,
    entryPoint: args.entryPoint,
  })
}

export {
  evaluateProReadiness,
  evaluateProReadinessForEntryPoint,
  proReadinessSelect,
}