// lib/credit/creditSettlement.test.ts
//
// Covers the two ways a creator-credit top-up can fail to reach a professional.
// Both leave the pro short-paid: the client's bill is a destination charge with
// no application fee, so the credit comes straight out of the pro's payout
// until this module puts it back (see the module header).

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  aggregate: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transfersCreate: vi.fn(),
  captureBookingException: vi.fn(),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ transfers: { create: mocks.transfersCreate } }),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

import { settleCreditTopUps, type CreditSettlementDb } from './creditSettlement'

const NOW = new Date('2026-08-28T10:00:00.000Z')

// No type escape needed: the module declares the narrow slice of the generated
// client it actually touches, so a stub satisfies it structurally.
function db(): CreditSettlementDb {
  return {
    clientCreditEntry: {
      findMany: mocks.findMany,
      aggregate: mocks.aggregate,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  }
}

function entry(overrides: {
  id?: string
  amountCents?: number
  stripeAccountId?: string | null
}) {
  return {
    id: overrides.id ?? 'entry_1',
    amount: new Prisma.Decimal((overrides.amountCents ?? 2500) / 100),
    bookingId: 'booking_1',
    booking: {
      id: 'booking_1',
      professionalId: 'pro_1',
      stripeCurrency: 'usd',
      professional: {
        paymentSettings:
          overrides.stripeAccountId === null
            ? null
            : { stripeAccountId: overrides.stripeAccountId ?? 'acct_1' },
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.aggregate.mockResolvedValue({ _sum: { amount: null } })
  mocks.update.mockResolvedValue({ id: 'entry_1' })
})

describe('settleCreditTopUps', () => {
  it('transfers and stamps the entry on the happy path', async () => {
    mocks.findMany.mockResolvedValue([entry({})])
    mocks.transfersCreate.mockResolvedValue({ id: 'tr_1' })

    const result = await settleCreditTopUps(db(), NOW)

    expect(result.settled).toBe(1)
    expect(result.settledCents).toBe(2500)
    expect(mocks.captureBookingException).not.toHaveBeenCalled()
  })

  // Not retryable by waiting: a pro with no connected account re-fails on every
  // run forever. The job counts it into `outstandingCents` and the route's own
  // comment says that number "should not grow run over run" — but nobody reads
  // a cron's 200 body, and the console line reaches Sentry only when
  // SENTRY_ENABLE_LOGS is on, which it is not by default.
  it('captures an UNPAYABLE top-up rather than only logging it', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    mocks.findMany.mockResolvedValue([entry({ stripeAccountId: null })])

    const result = await settleCreditTopUps(db(), NOW)

    expect(mocks.transfersCreate).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
    expect(mocks.captureBookingException).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'settleCreditTopUps',
        event: 'CREDIT_TOP_UP_UNPAYABLE',
        bookingId: 'booking_1',
      }),
    )

    consoleErrorSpy.mockRestore()
  })

  // The same-idempotency-key retry only backstops a TRANSIENT failure. A
  // permanent one (restricted or de-authorized connected account) re-fails
  // every run and the debt grows where nobody is looking.
  it('captures a FAILED transfer rather than only logging it', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const boom = new Error('account restricted')
    mocks.findMany.mockResolvedValue([entry({})])
    mocks.transfersCreate.mockRejectedValueOnce(boom)

    const result = await settleCreditTopUps(db(), NOW)

    expect(result.failed).toBe(1)
    expect(result.settled).toBe(0)
    expect(mocks.captureBookingException).toHaveBeenCalledWith({
      error: boom,
      route: 'settleCreditTopUps',
      event: 'CREDIT_TOP_UP_TRANSFER_FAILED',
      bookingId: 'booking_1',
    })

    consoleErrorSpy.mockRestore()
  })
})
