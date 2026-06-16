// lib/booking/publicCheckoutAvailability.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  Prisma,
  StripePaymentStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: mocks.bookingFindUnique },
  },
}))

import { getPublicCheckoutAvailability } from './publicCheckoutAvailability'

function makeBooking(overrides?: Record<string, unknown>) {
  return {
    clientId: 'client_1',
    status: BookingStatus.COMPLETED,
    checkoutStatus: BookingCheckoutStatus.READY,
    paymentCollectedAt: null,
    stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
    totalAmount: new Prisma.Decimal(45),
    stripeCurrency: 'usd',
    aftercareSummary: { sentToClientAt: new Date('2026-06-01T00:00:00.000Z') },
    professional: {
      paymentSettings: {
        acceptStripeCard: true,
        stripeChargesEnabled: true,
      },
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPublicCheckoutAvailability', () => {
  it('returns NOT_AVAILABLE when booking is missing', async () => {
    mocks.bookingFindUnique.mockResolvedValue(null)
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'NOT_AVAILABLE' })
  })

  it('returns NOT_AVAILABLE when the client does not own the booking', async () => {
    mocks.bookingFindUnique.mockResolvedValue(makeBooking({ clientId: 'other' }))
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'NOT_AVAILABLE' })
  })

  it('returns PAYABLE with amount for a finalized, unpaid booking', async () => {
    mocks.bookingFindUnique.mockResolvedValue(makeBooking())
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'PAYABLE', amountCents: 4500, currency: 'usd' })
  })

  it.each([
    ['PAID checkout status', { checkoutStatus: BookingCheckoutStatus.PAID }],
    ['WAIVED checkout status', { checkoutStatus: BookingCheckoutStatus.WAIVED }],
    ['payment collected', { paymentCollectedAt: new Date() }],
    [
      'stripe succeeded',
      { stripePaymentStatus: StripePaymentStatus.SUCCEEDED },
    ],
  ])('returns ALREADY_PAID when %s', async (_label, overrides) => {
    mocks.bookingFindUnique.mockResolvedValue(makeBooking(overrides))
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'ALREADY_PAID' })
  })

  it('returns NOT_AVAILABLE when aftercare is not finalized', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({ aftercareSummary: { sentToClientAt: null } }),
    )
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'NOT_AVAILABLE' })
  })

  it('returns NOT_AVAILABLE when the pro does not accept Stripe card', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({
        professional: {
          paymentSettings: {
            acceptStripeCard: false,
            stripeChargesEnabled: true,
          },
        },
      }),
    )
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'NOT_AVAILABLE' })
  })

  it('returns NOT_AVAILABLE for a non-positive total', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({ totalAmount: new Prisma.Decimal(0) }),
    )
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'NOT_AVAILABLE' })
  })

  it('returns NOT_AVAILABLE for a cancelled booking', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({ status: BookingStatus.CANCELLED }),
    )
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'NOT_AVAILABLE' })
  })
})
