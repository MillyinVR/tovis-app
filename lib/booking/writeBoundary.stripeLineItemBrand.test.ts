// lib/booking/writeBoundary.stripeLineItemBrand.test.ts
//
// The Stripe line-item description reaches the client's checkout page and their
// card statement, so it must carry the brand of the tenant the booking belongs
// to. It used to be the hardcoded literal "TOVIS booking: …", which showed a
// white-label tenant's client the platform's name at the moment they paid.
//
// The root tenant's brand displayName IS "TOVIS", so a root-tenant booking
// produces a byte-identical string before and after the fix — which is exactly
// why a test that only exercises the root tenant proves nothing. Every test
// here drives a NON-root tenant and asserts the brand actually moved.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingDepositStatus, BookingStatus, Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),

  recordStatusTransition: vi.fn(),
  recordStepTransition: vi.fn(),
  registerLifecycleDriftSink: vi.fn(),

  txBookingFindUnique: vi.fn(),

  getBrandForTenantContext: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: { findUnique: mocks.prismaBookingFindUnique },
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/lifecycleContract', () => ({
  recordStatusTransition: mocks.recordStatusTransition,
  recordStepTransition: mocks.recordStepTransition,
  registerLifecycleDriftSink: mocks.registerLifecycleDriftSink,
}))

// The seam under test. Returning a brand keyed off the context's slug lets a
// test tell "resolved from THIS booking's tenant" apart from "fell back".
vi.mock('@/lib/brand/forTenant', () => ({
  getBrandForTenantContext: mocks.getBrandForTenantContext,
}))

import { prepareClientDepositCheckout } from './writeBoundary'

const ROOT_TENANT = { id: 'tenant_root', slug: 'tovis-root' }
const WHITE_LABEL_TENANT = { id: 'tenant_salon', slug: 'salon-xyz' }

const BRAND_NAME_BY_SLUG: Record<string, string> = {
  'tovis-root': 'TOVIS',
  'salon-xyz': 'Salon XYZ',
}

function bookingRow(proTenant: { id: string; slug: string }) {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    depositStatus: BookingDepositStatus.PENDING,
    depositAmount: new Prisma.Decimal(25),
    discoveryFeeAmount: 0,
    proDiscoveryFeeAmount: 0,
    depositPaidAt: null,
    service: { name: 'Haircut' },
    proTenant,
    professional: {
      paymentSettings: {
        stripeAccountId: 'acct_test_123',
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    },
  }
}

async function prepareFor(proTenant: { id: string; slug: string }) {
  mocks.txBookingFindUnique.mockResolvedValue(bookingRow(proTenant))

  return prepareClientDepositCheckout({
    bookingId: 'booking_1',
    clientId: 'client_1',
  })
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
    async (args: { run: (ctx: { tx: unknown }) => Promise<unknown> }) =>
      args.run({
        tx: { booking: { findUnique: mocks.txBookingFindUnique } },
      }),
  )

  mocks.getBrandForTenantContext.mockImplementation(
    (ctx: { slug: string }) => ({
      displayName: BRAND_NAME_BY_SLUG[ctx.slug] ?? 'UNREGISTERED',
    }),
  )
})

describe('buildStripeLineItemDescription — tenant brand on the client receipt', () => {
  it("uses the white-label tenant's brand, not the platform's", async () => {
    const result = await prepareFor(WHITE_LABEL_TENANT)

    expect(result.stripe.lineItemDescription).toBe('Salon XYZ booking: Haircut')
    expect(result.stripe.lineItemDescription).not.toContain('TOVIS')
  })

  it('resolves from the booking’s own tenant, carrying isRoot correctly', async () => {
    await prepareFor(WHITE_LABEL_TENANT)

    expect(mocks.getBrandForTenantContext).toHaveBeenCalledWith({
      isRoot: false,
      tenantId: 'tenant_salon',
      slug: 'salon-xyz',
    })
  })

  it('still reads TOVIS for a root-tenant booking', async () => {
    const result = await prepareFor(ROOT_TENANT)

    expect(result.stripe.lineItemDescription).toBe('TOVIS booking: Haircut')
    expect(mocks.getBrandForTenantContext).toHaveBeenCalledWith({
      isRoot: true,
      tenantId: 'tenant_root',
      slug: 'tovis-root',
    })
  })

  it('falls back to the booking id when the service has no name', async () => {
    mocks.txBookingFindUnique.mockResolvedValue({
      ...bookingRow(WHITE_LABEL_TENANT),
      service: null,
    })

    const result = await prepareClientDepositCheckout({
      bookingId: 'booking_1',
      clientId: 'client_1',
    })

    expect(result.stripe.lineItemDescription).toBe('Salon XYZ booking booking_1')
  })
})
