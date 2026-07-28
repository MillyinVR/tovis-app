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

function makePaymentSettings(overrides?: Record<string, unknown>) {
  return {
    collectPaymentAt: 'AFTER_SERVICE',
    acceptCash: true,
    acceptCardOnFile: false,
    acceptTapToPay: false,
    acceptVenmo: false,
    acceptZelle: false,
    acceptAppleCash: false,
    acceptPaypal: false,
    acceptApplePay: false,
    acceptStripeCard: false,
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    tipsEnabled: true,
    allowCustomTip: true,
    tipSuggestions: null,
    venmoHandle: null,
    zelleHandle: null,
    appleCashHandle: null,
    paypalHandle: null,
    paymentNote: null,
    ...overrides,
  }
}

function makeBooking(overrides?: Record<string, unknown>) {
  return {
    clientId: 'client_1',
    status: BookingStatus.COMPLETED,
    checkoutStatus: BookingCheckoutStatus.READY,
    selectedPaymentMethod: null,
    paymentCollectedAt: null,
    stripePaymentStatus: StripePaymentStatus.NOT_STARTED,
    serviceSubtotalSnapshot: new Prisma.Decimal(45),
    productSubtotalSnapshot: new Prisma.Decimal(0),
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(45),
    stripeCurrency: 'usd',
    aftercareSummary: { sentToClientAt: new Date('2026-06-01T00:00:00.000Z') },
    professional: { paymentSettings: makePaymentSettings() },
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

  // The regression this whole helper caused: a pro who takes Venmo/Zelle/cash and
  // has never connected Stripe used to make the public page return NOT_AVAILABLE,
  // so an unclaimed client saw NO way to pay at all — and only discovered the
  // pro's real methods after creating an account.
  it('is PAYABLE with the pro’s off-platform methods when Stripe is absent', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({
        professional: {
          paymentSettings: makePaymentSettings({
            acceptVenmo: true,
            venmoHandle: '@amara',
            acceptZelle: true,
            zelleHandle: '555-1212',
          }),
        },
      }),
    )

    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })

    expect(r.status).toBe('PAYABLE')
    if (r.status !== 'PAYABLE') return

    expect(r.paymentOptions.methods).toEqual([
      { key: 'cash', label: 'Cash', handle: null },
      { key: 'venmo', label: 'Venmo', handle: '@amara' },
      { key: 'zelle', label: 'Zelle', handle: '555-1212' },
    ])
    expect(r.amounts.totalAmount).toBe('45')
    expect(r.amounts.amountCents).toBe(4500)
  })

  it('includes Stripe card once the connected account can charge', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({
        professional: {
          paymentSettings: makePaymentSettings({
            acceptStripeCard: true,
            stripeAccountId: 'acct_1',
            stripeChargesEnabled: true,
            stripePayoutsEnabled: true,
          }),
        },
      }),
    )

    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })

    expect(r.status).toBe('PAYABLE')
    if (r.status !== 'PAYABLE') return
    expect(r.paymentOptions.methods.map((m) => m.key)).toEqual([
      'cash',
      'stripe_card',
    ])
  })

  it('never offers a pro-run card rail to an unclaimed client', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({
        professional: {
          paymentSettings: makePaymentSettings({
            acceptCardOnFile: true,
            acceptTapToPay: true,
            acceptApplePay: true,
          }),
        },
      }),
    )

    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })

    expect(r.status).toBe('PAYABLE')
    if (r.status !== 'PAYABLE') return
    expect(r.paymentOptions.methods.map((m) => m.key)).toEqual(['cash'])
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

  // The client already said they sent it; re-offering the pay controls would
  // invite a second payment for the same booking.
  it('returns AWAITING_CONFIRMATION once the client has attested payment', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      makeBooking({
        checkoutStatus: BookingCheckoutStatus.AWAITING_CONFIRMATION,
      }),
    )
    const r = await getPublicCheckoutAvailability({
      bookingId: 'b1',
      clientId: 'client_1',
    })
    expect(r).toEqual({ status: 'AWAITING_CONFIRMATION' })
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
