// lib/pro/readiness/proReadiness.ts
//
// Evaluates whether a professional is "live" and bookable.
// Used by: dashboard banners, profile publishing, discovery/search filters,
// availability bootstrap/day routes, and booking mutation gates.
//

import {
  Prisma,
  ProfessionalLocationType,
  VerificationStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'

// ─── Public types ─────────────────────────────────────────────────────────────

export type LiveBookingMode = 'SALON' | 'MOBILE'

export type ProReadinessBlocker =
  | 'NO_ACTIVE_OFFERING'
  | 'NO_BOOKABLE_LOCATION'
  | 'SALON_MISSING_ADDRESS'
  | 'MOBILE_MISSING_BASE_CONFIG'
  | 'LOCATION_MISSING_TIMEZONE'
  | 'LOCATION_MISSING_WORKING_HOURS'
  | 'OFFERING_MISSING_SALON_PRICE_OR_DURATION'
  | 'OFFERING_MISSING_MOBILE_PRICE_OR_DURATION'
  | 'VERIFICATION_NOT_APPROVED'

export type ProReadiness =
  | { ok: true; liveModes: LiveBookingMode[]; readyLocationIds: string[] }
  | { ok: false; blockers: ProReadinessBlocker[] }

// ─── Internal data ────────────────────────────────────────────────────────────

const proReadinessSelect = {
  id: true,
  mobileRadiusMiles: true,
  mobileBasePostalCode: true,
  verificationStatus: true,
  locations: {
    select: {
      id: true,
      type: true,
      formattedAddress: true,
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

type WorkingHoursShape = Record<string, WorkingDay>

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function isValidWorkingHours(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false

  const workingHours = raw as WorkingHoursShape

  for (const day of DAY_KEYS) {
    if (!(day in workingHours)) return false
  }

  return DAY_KEYS.some((day) => {
    const value = workingHours[day]

    return (
      value?.enabled === true &&
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

function evaluateProReadiness(pro: ProReadinessRecord): ProReadiness {
  const blockers: ProReadinessBlocker[] = []

  // ── Verification ──────────────────────────────────────────────────────────
  // PENDING/manual-review style states are intentionally allowed for booking
  // readiness. REJECTED and NEEDS_INFO require action and block readiness.
  if (
    pro.verificationStatus === VerificationStatus.REJECTED ||
    pro.verificationStatus === VerificationStatus.NEEDS_INFO
  ) {
    blockers.push('VERIFICATION_NOT_APPROVED')
  }

  // ── Offerings ─────────────────────────────────────────────────────────────
  const activeOfferings = pro.offerings ?? []

  if (activeOfferings.length === 0) {
    blockers.push('NO_ACTIVE_OFFERING')
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
    blockers.push('NO_BOOKABLE_LOCATION')
  }

  const anyMissingTimezone = bookableLocations.some(
    (location) =>
      !location.timeZone || !isValidIanaTimeZone(location.timeZone),
  )

  if (anyMissingTimezone) {
    blockers.push('LOCATION_MISSING_TIMEZONE')
  }

  const anyMissingWorkingHours = bookableLocations.some(
    (location) => !isValidWorkingHours(location.workingHours),
  )

  if (anyMissingWorkingHours) {
    blockers.push('LOCATION_MISSING_WORKING_HOURS')
  }

  const bookableSalonLocations = bookableLocations.filter((location) =>
    isSalonLikeLocation(location.type),
  )

  const anySalonMissingAddress = bookableSalonLocations.some(
    (location) => !location.formattedAddress,
  )

  if (anySalonMissingAddress) {
    blockers.push('SALON_MISSING_ADDRESS')
  }

  const bookableMobileLocation = bookableLocations.find(
    (location) => location.type === ProfessionalLocationType.MOBILE_BASE,
  )

  if (bookableMobileLocation) {
    const hasMobileBase =
      Boolean(pro.mobileBasePostalCode) && Boolean(pro.mobileRadiusMiles)

    if (!hasMobileBase) {
      blockers.push('MOBILE_MISSING_BASE_CONFIG')
    }
  }

  const readyLocationIds = bookableLocations
    .filter((location) => {
      const hasTimezone =
        Boolean(location.timeZone) && isValidIanaTimeZone(location.timeZone)
      const hasWorkingHours = isValidWorkingHours(location.workingHours)
      const hasSalonAddress =
        !isSalonLikeLocation(location.type) || Boolean(location.formattedAddress)

      return hasTimezone && hasWorkingHours && hasSalonAddress
    })
    .map((location) => location.id)

  if (readyLocationIds.length === 0 && bookableLocations.length > 0) {
    blockers.push('NO_BOOKABLE_LOCATION')
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
        blockers.push('OFFERING_MISSING_SALON_PRICE_OR_DURATION')
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
        blockers.push('OFFERING_MISSING_MOBILE_PRICE_OR_DURATION')
      }
    }
  }

  const uniqueBlockers = [...new Set(blockers)]

  if (uniqueBlockers.length > 0) {
    return { ok: false, blockers: uniqueBlockers }
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

export async function checkProReadiness(
  professionalId: string,
): Promise<ProReadiness> {
  return checkProReadinessWithDb({
    db: prisma,
    professionalId,
  })
}

export { evaluateProReadiness, proReadinessSelect }