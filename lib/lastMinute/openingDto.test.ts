import { describe, expect, it } from 'vitest'
import { LastMinuteOfferType, LastMinuteTier, Prisma } from '@prisma/client'

import {
  incentiveLabel,
  mapOpeningServiceDtos,
  mapPublicIncentiveDto,
  type OpeningServiceRow,
} from './openingDto'

describe('incentiveLabel', () => {
  it('formats percent-off when a percent is present', () => {
    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.PERCENT_OFF,
        percentOff: 20,
        amountOff: null,
        freeAddOnService: null,
      }),
    ).toBe('20% off')
  })

  it('formats amount-off using the decimal value', () => {
    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.AMOUNT_OFF,
        percentOff: null,
        amountOff: new Prisma.Decimal('15.00'),
        freeAddOnService: null,
      }),
    ).toBe('$15 off')
  })

  it('labels free service and free add-on (named, then fallback)', () => {
    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.FREE_SERVICE,
        percentOff: null,
        amountOff: null,
        freeAddOnService: null,
      }),
    ).toBe('Free service')

    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.FREE_ADD_ON,
        percentOff: null,
        amountOff: null,
        freeAddOnService: { id: 's1', name: 'Scalp massage' },
      }),
    ).toBe('Scalp massage')

    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.FREE_ADD_ON,
        percentOff: null,
        amountOff: null,
        freeAddOnService: null,
      }),
    ).toBe('Free add-on')
  })

  it('falls back to "No incentive" for NONE or missing data', () => {
    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.NONE,
        percentOff: null,
        amountOff: null,
        freeAddOnService: null,
      }),
    ).toBe('No incentive')

    // percent-off with no percent value -> no incentive
    expect(
      incentiveLabel({
        offerType: LastMinuteOfferType.PERCENT_OFF,
        percentOff: null,
        amountOff: null,
        freeAddOnService: null,
      }),
    ).toBe('No incentive')
  })
})

describe('mapPublicIncentiveDto', () => {
  it('returns null when there is no plan', () => {
    expect(mapPublicIncentiveDto(null)).toBeNull()
  })

  it('maps a plan to its DTO, formatting amountOff as a money string', () => {
    expect(
      mapPublicIncentiveDto({
        tier: LastMinuteTier.WAITLIST,
        offerType: LastMinuteOfferType.AMOUNT_OFF,
        percentOff: null,
        amountOff: new Prisma.Decimal('15.50'),
        freeAddOnService: { id: 's1', name: 'Gloss' },
      }),
    ).toEqual({
      tier: LastMinuteTier.WAITLIST,
      offerType: LastMinuteOfferType.AMOUNT_OFF,
      label: '$15.5 off',
      percentOff: null,
      amountOff: '15.5',
      freeAddOnService: { id: 's1', name: 'Gloss' },
    })
  })
})

describe('mapOpeningServiceDtos', () => {
  it('stringifies prices and preserves order/fields', () => {
    const rows: OpeningServiceRow[] = [
      {
        id: 'os1',
        openingId: 'o1',
        serviceId: 'svc1',
        offeringId: 'off1',
        sortOrder: 0,
        service: {
          id: 'svc1',
          name: 'Cut',
          minPrice: new Prisma.Decimal('80.00'),
          defaultDurationMinutes: 60,
        },
        offering: {
          id: 'off1',
          title: 'Signature Cut',
          salonPriceStartingAt: new Prisma.Decimal('90.00'),
          mobilePriceStartingAt: null,
          salonDurationMinutes: 60,
          mobileDurationMinutes: null,
          offersInSalon: true,
          offersMobile: false,
        },
      },
    ]

    expect(mapOpeningServiceDtos(rows)).toEqual([
      {
        id: 'os1',
        openingId: 'o1',
        serviceId: 'svc1',
        offeringId: 'off1',
        sortOrder: 0,
        service: {
          id: 'svc1',
          name: 'Cut',
          minPrice: '80',
          defaultDurationMinutes: 60,
        },
        offering: {
          id: 'off1',
          title: 'Signature Cut',
          salonPriceStartingAt: '90',
          mobilePriceStartingAt: null,
          salonDurationMinutes: 60,
          mobileDurationMinutes: null,
          offersInSalon: true,
          offersMobile: false,
        },
      },
    ])
  })
})
