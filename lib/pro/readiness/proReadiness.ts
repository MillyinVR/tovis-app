// lib/pro/readiness/proReadiness.ts
//
// Evaluates whether a professional is "live" and bookable.
// Used by: dashboard banners, profile publishing, discovery/search filters,
// availability bootstrap/day routes, and POST /api/bookings/finalize.
//

import { ProfessionalLocationType, VerificationStatus } from '@prisma/client'
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
  | { ok: true; liveModes: LiveBookingMode[] }
  | { ok: false; blockers: ProReadinessBlocker[] }

// ─── Internal data ────────────────────────────────────────────────────────────

const proReadinessSelect = {
  id: true,
  mobileRadiusMiles: true,
  mobileBasePostalCode: true,
  verificationStatus: true,
  locations: {
    where: { isBookable: true },
    select: {
      id: true,
      type: true,
      formattedAddress: true,
      timeZone: true,
      workingHours: true,
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

function isValidWorkingHours(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false

  const wh = raw as WorkingHoursShape
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  // Must have at least these 7 keys
  for (const day of DAY_KEYS) {
    if (!(day in wh)) return false
  }

  // At least one day must be enabled with valid hours
  const hasEnabledDay = DAY_KEYS.some((day) => {
    const d = wh[day]
    return (
      d?.enabled === true &&
      typeof d.start === 'string' &&
      typeof d.end === 'string' &&
      d.start.length > 0 &&
      d.end.length > 0
    )
  })

  return hasEnabledDay
}

// ─── Core evaluation ──────────────────────────────────────────────────────────

type ProReadinessRecord = {
  mobileRadiusMiles: number | null
  mobileBasePostalCode: string | null
  verificationStatus: VerificationStatus
  locations: Array<{
    id: string
    type: ProfessionalLocationType
    formattedAddress: string | null
    timeZone: string | null
    workingHours: unknown
  }>
  offerings: Array<{
    id: string
    offersInSalon: boolean
    offersMobile: boolean
    salonPriceStartingAt: unknown
    salonDurationMinutes: number | null
    mobilePriceStartingAt: unknown
    mobileDurationMinutes: number | null
  }>
}

function evaluateProReadiness(pro: ProReadinessRecord): ProReadiness {
  const blockers: ProReadinessBlocker[] = []

  // ── Verification ──────────────────────────────────────────────────────────
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
  const bookableLocations = pro.locations ?? []
  if (bookableLocations.length === 0) {
    blockers.push('NO_BOOKABLE_LOCATION')
  }

  const salonLocations = bookableLocations.filter(
    (l) => l.type === ProfessionalLocationType.SALON || l.type === ProfessionalLocationType.SUITE,
  )
  const mobileLocation = bookableLocations.find(
    (l) => l.type === ProfessionalLocationType.MOBILE_BASE,
  )

  // Validate location-level fields
  for (const loc of bookableLocations) {
    if (!loc.timeZone || !isValidIanaTimeZone(loc.timeZone)) {
      blockers.push('LOCATION_MISSING_TIMEZONE')
      break
    }
  }

  for (const loc of bookableLocations) {
    if (!isValidWorkingHours(loc.workingHours)) {
      blockers.push('LOCATION_MISSING_WORKING_HOURS')
      break
    }
  }

  // Salon-specific checks
  for (const loc of salonLocations) {
    if (!loc.formattedAddress) {
      blockers.push('SALON_MISSING_ADDRESS')
      break
    }
  }

  // Mobile-specific checks
  if (mobileLocation) {
    const hasMobileBase =
      Boolean(pro.mobileBasePostalCode) && Boolean(pro.mobileRadiusMiles)
    if (!hasMobileBase) {
      blockers.push('MOBILE_MISSING_BASE_CONFIG')
    }
  }

  // ── Offering price/duration checks per mode ───────────────────────────────
  if (activeOfferings.length > 0) {
    const hasSalonMode = salonLocations.length > 0
    const hasMobileMode = Boolean(mobileLocation)

    if (hasSalonMode) {
      const missingSalon = activeOfferings
        .filter((o) => o.offersInSalon)
        .some(
          (o) =>
            o.salonPriceStartingAt == null || o.salonDurationMinutes == null,
        )
      if (missingSalon) {
        blockers.push('OFFERING_MISSING_SALON_PRICE_OR_DURATION')
      }
    }

    if (hasMobileMode) {
      const missingMobile = activeOfferings
        .filter((o) => o.offersMobile)
        .some(
          (o) =>
            o.mobilePriceStartingAt == null || o.mobileDurationMinutes == null,
        )
      if (missingMobile) {
        blockers.push('OFFERING_MISSING_MOBILE_PRICE_OR_DURATION')
      }
    }
  }

  if (blockers.length > 0) {
    return { ok: false, blockers: [...new Set(blockers)] }
  }

  // ── Determine live modes ──────────────────────────────────────────────────
  const liveModes: LiveBookingMode[] = []

  if (salonLocations.length > 0 && activeOfferings.some((o) => o.offersInSalon)) {
    liveModes.push('SALON')
  }
  if (mobileLocation && activeOfferings.some((o) => o.offersMobile)) {
    liveModes.push('MOBILE')
  }

  if (liveModes.length === 0) {
    // Edge case: locations + offerings exist but no mode overlap
    return {
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    }
  }

  return { ok: true, liveModes }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Loads all fields needed for readiness evaluation from the DB and returns
 * a structured `ProReadiness` result.
 *
 * Callers that already have the data can use `evaluateProReadinessFromData`
 * to avoid an extra DB round-trip.
 */
export async function checkProReadiness(
  professionalId: string,
): Promise<ProReadiness> {
  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: proReadinessSelect,
  })

  if (!pro) {
    return { ok: false, blockers: ['NO_BOOKABLE_LOCATION'] }
  }

  return evaluateProReadiness(pro as ProReadinessRecord)
}

export { evaluateProReadiness, proReadinessSelect }
