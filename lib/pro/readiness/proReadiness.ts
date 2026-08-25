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
} from '@prisma/client'

import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { requiresLicense } from '@/lib/licensing/licenseRequirement'
import { isBarredProStatus } from '@/lib/proTrustState'

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
  | 'VERIFICATION_BARRED'
  | 'LICENSE_EXPIRED'

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
  professionType: true,
  licenseState: true,
  licenseExpiry: true,
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
  /**
   * Where the booking came from. No readiness rule varies by it any more —
   * dropping the broad-discovery bar was the last one — but the seam is kept
   * rather than ripped out: every caller in the booking write path already
   * threads a real value through, and v2's products/classes are the obvious
   * next rule that would want it. If v2 does not, remove it there and here
   * together rather than leaving it half-plumbed.
   */
  entryPoint: ProBookingEntryPoint
}): ProReadiness {
  const { pro } = args
  const blockers = new Set<ProReadinessBlocker>()

  // ── Verification ──────────────────────────────────────────────────────────
  // A verified licence is a BADGE, not a gate (Tori, 2026-08-25). The only
  // verification state that blocks a booking is an admin's active refusal —
  // REJECTED, or NEEDS_INFO meaning we asked for something and are waiting.
  // The rule itself lives in lib/proTrustState.ts, which is also what decides
  // public listing; a second copy here is how the two drift apart.
  //
  // This used to bar an unreviewed pro from BROAD_DISCOVERY as well, so a pro
  // who signed up this morning could take a booking from their own link but
  // not be found by anyone browsing. That blocker is gone, not merely unused:
  // "not approved" and "barred" are now the same question, so a second
  // entry-point-dependent check could only ever repeat this one.
  if (isBarredProStatus(pro.verificationStatus)) {
    addBlocker(blockers, 'VERIFICATION_BARRED')
  }

  // An actually-expired license blocks every entry point. A license merely
  // approaching expiry (or one we have no date for) does NOT — that's a banner
  // nudge, not an access cut. Editing license info never lands here unless the
  // date itself is in the past.
  if (
    pro.professionType &&
    requiresLicense(pro.professionType, pro.licenseState) &&
    pro.licenseExpiry &&
    pro.licenseExpiry.getTime() < Date.now()
  ) {
    addBlocker(blockers, 'LICENSE_EXPIRED')
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