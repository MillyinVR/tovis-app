import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  Prisma,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  computeBookingTotal,
  getBaseAndAddOnNames,
  needsCloseout,
  normalizeBookingsStatusFilter,
  type BookingsListRow,
} from './proBookingsList'

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value)
}

// A complete, valid row; tests override only the fields they exercise so the
// Prisma payload type stays honest (no `as` casts).
function makeRow(overrides: Partial<BookingsListRow> = {}): BookingsListRow {
  const base: BookingsListRow = {
    id: 'bk_1',
    status: BookingStatus.ACCEPTED,
    sessionStep: SessionStep.NONE,
    scheduledFor: new Date('2026-06-29T17:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    locationTimeZone: 'America/Los_Angeles',
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    paymentCollectedAt: null,
    aftercareSummary: null,
    locationType: ServiceLocationType.SALON,
    locationAddressSnapshot: null,
    locationLatSnapshot: null,
    locationLngSnapshot: null,
    clientAddressSnapshot: null,
    clientAddressLatSnapshot: null,
    clientAddressLngSnapshot: null,
    totalDurationMinutes: 60,
    subtotalSnapshot: money('0.00'),
    totalAmount: null,
    discountAmount: null,
    taxAmount: null,
    tipAmount: null,
    service: { name: 'Balayage' },
    serviceItems: [],
    client: {
      id: 'cl_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: null,
      user: { email: 'ada@example.com' },
    },
  }
  return { ...base, ...overrides }
}

describe('normalizeBookingsStatusFilter', () => {
  it('accepts known statuses (case-insensitive) and defaults to ALL', () => {
    expect(normalizeBookingsStatusFilter('pending')).toBe('PENDING')
    expect(normalizeBookingsStatusFilter('IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(normalizeBookingsStatusFilter('cancelled')).toBe('CANCELLED')
    expect(normalizeBookingsStatusFilter('')).toBe('ALL')
    expect(normalizeBookingsStatusFilter('nonsense')).toBe('ALL')
    expect(normalizeBookingsStatusFilter(undefined)).toBe('ALL')
  })
})

describe('computeBookingTotal', () => {
  it('prefers the explicit totalAmount', () => {
    const total = computeBookingTotal(makeRow({ totalAmount: money('120.00') }))
    expect(total?.toFixed(2)).toBe('120.00')
  })

  it('falls back to subtotal minus discount plus tax and tip', () => {
    const total = computeBookingTotal(
      makeRow({
        subtotalSnapshot: money('100.00'),
        discountAmount: money('10.00'),
        taxAmount: money('8.00'),
        tipAmount: money('15.00'),
      }),
    )
    expect(total?.toFixed(2)).toBe('113.00')
  })

  it('uses the subtotal alone when there are no modifiers', () => {
    const total = computeBookingTotal(
      makeRow({ subtotalSnapshot: money('65.00') }),
    )
    expect(total?.toFixed(2)).toBe('65.00')
  })
})

describe('getBaseAndAddOnNames', () => {
  it('splits the base service from its add-ons', () => {
    const { baseName, addOnNames } = getBaseAndAddOnNames(
      makeRow({
        serviceItems: [
          {
            id: 'it_1',
            itemType: BookingServiceItemType.ADD_ON,
            sortOrder: 1,
            service: { name: 'Toner' },
            priceSnapshot: money('20.00'),
            durationMinutesSnapshot: 15,
            parentItemId: 'it_2',
          },
          {
            id: 'it_2',
            itemType: BookingServiceItemType.BASE,
            sortOrder: 0,
            service: { name: 'Full color' },
            priceSnapshot: money('90.00'),
            durationMinutesSnapshot: 90,
            parentItemId: null,
          },
        ],
      }),
    )
    expect(baseName).toBe('Full color')
    expect(addOnNames).toEqual(['Toner'])
  })

  it('falls back to the booking service name with no items', () => {
    const { baseName, addOnNames } = getBaseAndAddOnNames(makeRow())
    expect(baseName).toBe('Balayage')
    expect(addOnNames).toEqual([])
  })
})

describe('needsCloseout', () => {
  it('is true when aftercare is sent but payment is still open', () => {
    expect(
      needsCloseout(
        makeRow({
          status: BookingStatus.IN_PROGRESS,
          aftercareSummary: { sentToClientAt: new Date('2026-06-29T18:00:00Z') },
          checkoutStatus: BookingCheckoutStatus.NOT_READY,
          paymentCollectedAt: null,
        }),
      ),
    ).toBe(true)
  })

  it('is false once payment is collected', () => {
    expect(
      needsCloseout(
        makeRow({
          status: BookingStatus.IN_PROGRESS,
          aftercareSummary: { sentToClientAt: new Date('2026-06-29T18:00:00Z') },
          checkoutStatus: BookingCheckoutStatus.PAID,
          paymentCollectedAt: new Date('2026-06-29T18:30:00Z'),
        }),
      ),
    ).toBe(false)
  })

  it('is false when aftercare has not been sent', () => {
    expect(
      needsCloseout(makeRow({ status: BookingStatus.IN_PROGRESS })),
    ).toBe(false)
  })

  it('is false for terminal/finished bookings', () => {
    expect(
      needsCloseout(
        makeRow({
          status: BookingStatus.COMPLETED,
          aftercareSummary: { sentToClientAt: new Date('2026-06-29T18:00:00Z') },
        }),
      ),
    ).toBe(false)
  })
})
