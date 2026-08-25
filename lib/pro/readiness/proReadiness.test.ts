import { describe, expect, it } from 'vitest'
import {
  Prisma,
  ProfessionalLocationType,
  ProfessionType,
  StripeAccountStatus,
  VerificationStatus,
} from '@prisma/client'
import {
  evaluateProReadiness,
  evaluateProReadinessForEntryPoint,
  type ProBookingEntryPoint,
} from './proReadiness'

type ReadinessInput = Parameters<typeof evaluateProReadiness>[0]

const bookingEntryPoints: ProBookingEntryPoint[] = [
  'BROAD_DISCOVERY',
  'SPECIFIC_SEARCH',
  'DIRECT_PROFILE',
  'NFC_CARD',
  'SHORT_CODE',
  'QR_CODE',
  'PRO_CREATED',
]

const validWorkingHours = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: false, start: '', end: '' },
  wed: { enabled: false, start: '', end: '' },
  thu: { enabled: false, start: '', end: '' },
  fri: { enabled: false, start: '', end: '' },
  sat: { enabled: false, start: '', end: '' },
  sun: { enabled: false, start: '', end: '' },
}

function makeLocation(
  overrides: Partial<ReadinessInput['locations'][number]> = {},
): ReadinessInput['locations'][number] {
  return {
    id: 'loc_1',
    type: ProfessionalLocationType.SALON,
    formattedAddress: '123 Main St, San Diego, CA',
    lat: new Prisma.Decimal('32.715736'),
    lng: new Prisma.Decimal('-117.161087'),
    timeZone: 'America/Los_Angeles',
    workingHours: validWorkingHours,
    isBookable: true,
    ...overrides,
  }
}

function makeOffering(
  overrides: Partial<ReadinessInput['offerings'][number]> = {},
): ReadinessInput['offerings'][number] {
  return {
    id: 'offering_1',
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal('100'),
    salonDurationMinutes: 60,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    ...overrides,
  }
}

function makePro(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    id: 'pro_1',
    mobileRadiusMiles: null,
    mobileBasePostalCode: null,
    verificationStatus: VerificationStatus.APPROVED,
    professionType: null,
    licenseState: null,
    licenseExpiry: null,
    paymentSettings: {
      acceptStripeCard: false,
      stripeAccountStatus: StripeAccountStatus.NOT_STARTED,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false,
    },
    locations: [makeLocation()],
    offerings: [makeOffering()],
    ...overrides,
  }
}

describe('license expiry gating', () => {
  const DAY = 86_400_000

  it('blocks every entry point when a license-required pro is expired', () => {
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        professionType: ProfessionType.COSMETOLOGIST,
        licenseState: 'CA',
        licenseExpiry: new Date(Date.now() - DAY),
      }),
      entryPoint: 'DIRECT_PROFILE',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.blockers).toContain('LICENSE_EXPIRED')
  })

  it('does not block when the license is merely expiring soon (future date)', () => {
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        professionType: ProfessionType.COSMETOLOGIST,
        licenseState: 'CA',
        licenseExpiry: new Date(Date.now() + 10 * DAY),
      }),
      entryPoint: 'DIRECT_PROFILE',
    })
    expect(result.ok).toBe(true)
  })

  it('does not gate professions that need no license, even past the date', () => {
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        professionType: ProfessionType.MAKEUP_ARTIST,
        licenseState: 'CA',
        licenseExpiry: new Date(Date.now() - DAY),
      }),
      entryPoint: 'DIRECT_PROFILE',
    })
    expect(result.ok).toBe(true)
  })

  it('does not gate when no expiry is on file', () => {
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        professionType: ProfessionType.COSMETOLOGIST,
        licenseState: 'CA',
        licenseExpiry: null,
      }),
      entryPoint: 'DIRECT_PROFILE',
    })
    expect(result.ok).toBe(true)
  })
})

describe('evaluateProReadiness', () => {
  it('lets an unreviewed pro be found by broad discovery when otherwise ready', () => {
    // The rule this file used to enforce, inverted on purpose (Tori,
    // 2026-08-25): a verified licence is a BADGE, not a gate. An unreviewed pro
    // could already take a booking from their own link — barring them from
    // broad discovery only meant nobody could FIND the pro we were happy to let
    // them book.
    for (const status of [
      VerificationStatus.PENDING,
      VerificationStatus.PENDING_MANUAL_REVIEW,
    ]) {
      const result = evaluateProReadinessForEntryPoint({
        pro: makePro({ verificationStatus: status }),
        entryPoint: 'BROAD_DISCOVERY',
      })

      expect(result).toEqual({
        ok: true,
        liveModes: ['SALON'],
        readyLocationIds: ['loc_1'],
      })
    }
  })

  it('bars a refused pro from broad discovery like every other entry point', () => {
    // The half that did NOT change: an admin's active "no" still blocks, and
    // now it blocks uniformly rather than adding a second discovery-only code.
    for (const status of [
      VerificationStatus.REJECTED,
      VerificationStatus.NEEDS_INFO,
    ]) {
      expect(
        evaluateProReadinessForEntryPoint({
          pro: makePro({ verificationStatus: status }),
          entryPoint: 'BROAD_DISCOVERY',
        }),
      ).toEqual({ ok: false, blockers: ['VERIFICATION_BARRED'] })
    }
  })

  it('allows pending/manual-review pros through specific search when otherwise ready', () => {
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.PENDING_MANUAL_REVIEW,
      }),
      entryPoint: 'SPECIFIC_SEARCH',
    })

    expect(result).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('allows pending/manual-review pros through direct access when otherwise ready', () => {
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.PENDING_MANUAL_REVIEW,
      }),
      entryPoint: 'DIRECT_PROFILE',
    })

    expect(result).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('allows pending/manual-review pros through NFC and short-code booking paths when otherwise ready', () => {
    const nfcResult = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.PENDING_MANUAL_REVIEW,
      }),
      entryPoint: 'NFC_CARD',
    })

    expect(nfcResult).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })

    const shortCodeResult = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.PENDING_MANUAL_REVIEW,
      }),
      entryPoint: 'SHORT_CODE',
    })

    expect(shortCodeResult).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('allows pending/manual-review pros through QR and pro-created booking paths when otherwise ready', () => {
    const qrResult = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.PENDING_MANUAL_REVIEW,
      }),
      entryPoint: 'QR_CODE',
    })

    expect(qrResult).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })

    const proCreatedResult = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.PENDING_MANUAL_REVIEW,
      }),
      entryPoint: 'PRO_CREATED',
    })

    expect(proCreatedResult).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('blocks rejected pros from every booking entry point', () => {
    for (const entryPoint of bookingEntryPoints) {

      const result = evaluateProReadinessForEntryPoint({
        pro: makePro({
          verificationStatus: VerificationStatus.REJECTED,
        }),
        entryPoint,
      })

      // Uniform across every entry point — there is no longer a
      // discovery-only verification code to add on top.
      expect(result).toEqual({
        ok: false,
        blockers: ['VERIFICATION_BARRED'],
      })
    }
  })

  it('blocks needs-info pros from every booking entry point', () => {
    for (const entryPoint of bookingEntryPoints) {
      const result = evaluateProReadinessForEntryPoint({
        pro: makePro({
          verificationStatus: VerificationStatus.NEEDS_INFO,
        }),
        entryPoint,
      })

      // Uniform across every entry point — there is no longer a
      // discovery-only verification code to add on top.
      expect(result).toEqual({
        ok: false,
        blockers: ['VERIFICATION_BARRED'],
      })
    }
  })

  it('requires payment readiness for every booking entry point when Stripe card payments are accepted', () => {
    for (const entryPoint of bookingEntryPoints) {
      const result = evaluateProReadinessForEntryPoint({
        pro: makePro({
          paymentSettings: {
            acceptStripeCard: true,
            stripeAccountStatus: StripeAccountStatus.ONBOARDING_STARTED,
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            stripeDetailsSubmitted: false,
          },
        }),
        entryPoint,
      })

      expect(result).toEqual({
        ok: false,
        blockers: ['STRIPE_NOT_READY'],
      })
    }
  })

  it('combines verification and payment blockers when both apply', () => {
    // REJECTED rather than PENDING_MANUAL_REVIEW: an unreviewed pro no longer
    // contributes a verification blocker at all, so the old status would have
    // made this a one-blocker test wearing a two-blocker name.
    const result = evaluateProReadinessForEntryPoint({
      pro: makePro({
        verificationStatus: VerificationStatus.REJECTED,
        paymentSettings: {
          acceptStripeCard: true,
          stripeAccountStatus: StripeAccountStatus.ONBOARDING_STARTED,
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          stripeDetailsSubmitted: false,
        },
      }),
      entryPoint: 'BROAD_DISCOVERY',
    })

    expect(result).toEqual({
      ok: false,
      blockers: ['VERIFICATION_BARRED', 'STRIPE_NOT_READY'],
    })
  })

  it('marks an approved pro with one active offering and one ready bookable salon location as ready', () => {
    const result = evaluateProReadiness(makePro())

    expect(result).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('blocks rejected or needs-info verification states', () => {
    expect(
      evaluateProReadiness(
        makePro({
          verificationStatus: VerificationStatus.REJECTED,
        }),
      ),
    ).toEqual({
      ok: false,
      blockers: ['VERIFICATION_BARRED'],
    })

    expect(
      evaluateProReadiness(
        makePro({
          verificationStatus: VerificationStatus.NEEDS_INFO,
        }),
      ),
    ).toEqual({
      ok: false,
      blockers: ['VERIFICATION_BARRED'],
    })
  })

  it('allows manual-review style verification states when the pro is otherwise ready', () => {
    const pendingStatus = VerificationStatus.PENDING_MANUAL_REVIEW

    const result = evaluateProReadiness(
      makePro({
        verificationStatus: pendingStatus,
      }),
    )

    expect(result).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('blocks when there are no active offerings', () => {
    const result = evaluateProReadiness(
      makePro({
        offerings: [],
      }),
    )

    expect(result).toEqual({
      ok: false,
      blockers: ['NO_ACTIVE_OFFERING'],
    })
  })

  it('blocks when there are no bookable locations', () => {
    const result = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            isBookable: false,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      ok: false,
      blockers: ['NO_BOOKABLE_LOCATION'],
    })
  })

  it('ignores invalid draft locations when a ready bookable location exists', () => {
    const result = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            id: 'draft_loc',
            isBookable: false,
            formattedAddress: null,
            timeZone: null,
            workingHours: null,
          }),
          makeLocation({
            id: 'bookable_loc',
            isBookable: true,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['bookable_loc'],
    })
  })

  it('blocks bookable locations missing timezone or working hours', () => {
    const missingTimezone = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            timeZone: null,
          }),
        ],
      }),
    )

    expect(missingTimezone).toEqual({
      ok: false,
      blockers: ['LOCATION_MISSING_TIMEZONE', 'NO_BOOKABLE_LOCATION'],
    })

    const missingWorkingHours = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            workingHours: null,
          }),
        ],
      }),
    )

    expect(missingWorkingHours).toEqual({
      ok: false,
      blockers: ['LOCATION_MISSING_WORKING_HOURS', 'NO_BOOKABLE_LOCATION'],
    })
  })

  it('blocks bookable salon locations missing an address', () => {
    const result = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            formattedAddress: null,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      ok: false,
      blockers: ['SALON_MISSING_ADDRESS', 'NO_BOOKABLE_LOCATION'],
    })
  })

  it('blocks salon offerings missing price or duration when salon mode is ready', () => {
    const result = evaluateProReadiness(
      makePro({
        offerings: [
          makeOffering({
            salonPriceStartingAt: null,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      ok: false,
      blockers: ['OFFERING_MISSING_SALON_PRICE_OR_DURATION'],
    })
  })

  it('blocks bookable locations missing geo coordinates', () => {
    const result = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            lat: null,
            lng: null,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      ok: false,
      blockers: ['LOCATION_MISSING_GEO', 'NO_BOOKABLE_LOCATION'],
    })
  })

  it('blocks Stripe card payments when Stripe Connect is not ready', () => {
    const result = evaluateProReadiness(
      makePro({
        paymentSettings: {
          acceptStripeCard: true,
          stripeAccountStatus: StripeAccountStatus.ONBOARDING_STARTED,
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
          stripeDetailsSubmitted: false,
        },
      }),
    )

    expect(result).toEqual({
      ok: false,
      blockers: ['STRIPE_NOT_READY'],
    })
  })

  it('allows Stripe card payments when Stripe Connect is ready', () => {
    const result = evaluateProReadiness(
      makePro({
        paymentSettings: {
          acceptStripeCard: true,
          stripeAccountStatus: StripeAccountStatus.ENABLED,
          stripeChargesEnabled: true,
          stripePayoutsEnabled: true,
          stripeDetailsSubmitted: true,
        },
      }),
    )

    expect(result).toEqual({
      ok: true,
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('marks a mobile pro ready only when mobile base config and mobile offering fields are complete', () => {
    const result = evaluateProReadiness(
      makePro({
        mobileBasePostalCode: '92101',
        mobileRadiusMiles: 15,
        locations: [
          makeLocation({
            id: 'mobile_loc',
            type: ProfessionalLocationType.MOBILE_BASE,
            formattedAddress: null,
          }),
        ],
        offerings: [
          makeOffering({
            offersInSalon: false,
            offersMobile: true,
            salonPriceStartingAt: null,
            salonDurationMinutes: null,
            mobilePriceStartingAt: new Prisma.Decimal('150'),
            mobileDurationMinutes: 90,
          }),
        ],
      }),
    )

    expect(result).toEqual({
      ok: true,
      liveModes: ['MOBILE'],
      readyLocationIds: ['mobile_loc'],
    })
  })

  it('blocks mobile mode when base config or mobile offering fields are missing', () => {
    const missingBaseConfig = evaluateProReadiness(
      makePro({
        locations: [
          makeLocation({
            type: ProfessionalLocationType.MOBILE_BASE,
            formattedAddress: null,
          }),
        ],
        offerings: [
          makeOffering({
            offersInSalon: false,
            offersMobile: true,
            salonPriceStartingAt: null,
            salonDurationMinutes: null,
            mobilePriceStartingAt: new Prisma.Decimal('150'),
            mobileDurationMinutes: 90,
          }),
        ],
      }),
    )

    expect(missingBaseConfig).toEqual({
      ok: false,
      blockers: ['MOBILE_MISSING_BASE_CONFIG'],
    })

    const missingMobilePrice = evaluateProReadiness(
      makePro({
        mobileBasePostalCode: '92101',
        mobileRadiusMiles: 15,
        locations: [
          makeLocation({
            type: ProfessionalLocationType.MOBILE_BASE,
            formattedAddress: null,
          }),
        ],
        offerings: [
          makeOffering({
            offersInSalon: false,
            offersMobile: true,
            salonPriceStartingAt: null,
            salonDurationMinutes: null,
            mobilePriceStartingAt: null,
            mobileDurationMinutes: 90,
          }),
        ],
      }),
    )

    expect(missingMobilePrice).toEqual({
      ok: false,
      blockers: ['OFFERING_MISSING_MOBILE_PRICE_OR_DURATION'],
    })
  })
})