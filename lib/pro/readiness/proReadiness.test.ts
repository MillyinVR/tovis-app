import { describe, expect, it } from 'vitest'
import {
  Prisma,
  ProfessionalLocationType,
  VerificationStatus,
} from '@prisma/client'

import { evaluateProReadiness } from './proReadiness'

type ReadinessInput = Parameters<typeof evaluateProReadiness>[0]

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
    locations: [makeLocation()],
    offerings: [makeOffering()],
    ...overrides,
  }
}

describe('evaluateProReadiness', () => {
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
      blockers: ['VERIFICATION_NOT_APPROVED'],
    })

    expect(
      evaluateProReadiness(
        makePro({
          verificationStatus: VerificationStatus.NEEDS_INFO,
        }),
      ),
    ).toEqual({
      ok: false,
      blockers: ['VERIFICATION_NOT_APPROVED'],
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