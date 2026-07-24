// M13 (payment-booking-integrity-audit-plan.md §19) — direct coverage for
// captureStripeDisputeAlert's flavor → log-identity mapping.
//
// A booking can carry three distinct charges, each with its own dispute freeze
// and its own alerting identity: the final-bill PI (SERVICE → `stripe_dispute`,
// the pre-existing identity existing alerting keys on), the discovery-deposit PI
// (DEPOSIT → `stripe_deposit_dispute`, M4) and the no-show-fee PI (NO_SHOW_FEE →
// `stripe_no_show_fee_dispute`, M15 GAP B). The routing suites only assert the
// alert is CALLED with the right flavor; nothing pinned that each flavor emits
// its distinct `event`/label so the alerts stay tellable apart. This does — the
// read/observability mirror of applyStripeDispute.test.ts. Mirrors the
// captureStripeAmountMismatch test's Sentry+console harness.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tags: Record<string, unknown> = {}

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => sentry)

import { captureStripeDisputeAlert } from './bookingEvents'

beforeEach(() => {
  sentry.captureMessage.mockReset()
  for (const key of Object.keys(tags)) delete tags[key]
  // Re-implement withScope each run so the scope records setTag into `tags`.
  sentry.withScope.mockImplementation((cb: (scope: unknown) => void) =>
    cb({
      setLevel: vi.fn(),
      setTag: vi.fn((key: string, value: unknown) => {
        tags[key] = value
      }),
      setContext: vi.fn(),
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const BASE = {
  bookingId: 'booking_1',
  paymentIntentId: 'pi_1',
  disputeId: 'dp_1',
  disputeStatus: 'needs_response',
  outcome: 'OPEN' as const,
  eventType: 'charge.dispute.created',
}

type Flavor = 'SERVICE' | 'DEPOSIT' | 'NO_SHOW_FEE'

const CASES: Array<{ flavor: Flavor; event: string; label: string }> = [
  { flavor: 'SERVICE', event: 'stripe_dispute', label: 'Stripe dispute' },
  { flavor: 'DEPOSIT', event: 'stripe_deposit_dispute', label: 'Stripe deposit dispute' },
  {
    flavor: 'NO_SHOW_FEE',
    event: 'stripe_no_show_fee_dispute',
    label: 'Stripe no-show fee dispute',
  },
]

describe('captureStripeDisputeAlert — flavor → log identity', () => {
  for (const { flavor, event, label } of CASES) {
    it(`${flavor} emits the ${event} identity on both Sentry and the structured log`, () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      captureStripeDisputeAlert({ ...BASE, flavor })

      // Structured log line — the field alerting pipelines key on.
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const logged = JSON.parse(errorSpy.mock.calls[0]?.[0] as string)
      expect(logged).toMatchObject({
        level: 'error',
        namespace: 'payments',
        event,
        flavor,
        outcome: 'OPEN',
        eventType: 'charge.dispute.created',
        bookingId: 'booking_1',
        paymentIntentId: 'pi_1',
        disputeId: 'dp_1',
        disputeStatus: 'needs_response',
      })

      // Sentry message carries the flavor-specific label + outcome + booking.
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
      const [message, level] = sentry.captureMessage.mock.calls[0] ?? []
      expect(message).toContain(label)
      expect(message).toContain('OPEN')
      expect(message).toContain('booking_1')
      expect(level).toBe('error')

      // Sentry tags route the alert: the same event identity + the flavor.
      expect(tags['payments.event']).toBe(event)
      expect(tags['payments.dispute.flavor']).toBe(flavor)
      expect(tags['payments.dispute.outcome']).toBe('OPEN')

      errorSpy.mockRestore()
    })
  }

  it('a LOST outcome still emits its flavor identity (alert-on-LOST path)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    captureStripeDisputeAlert({
      ...BASE,
      flavor: 'DEPOSIT',
      outcome: 'LOST',
      disputeStatus: 'lost',
      eventType: 'charge.dispute.closed',
    })

    const logged = JSON.parse(errorSpy.mock.calls[0]?.[0] as string)
    expect(logged).toMatchObject({ event: 'stripe_deposit_dispute', outcome: 'LOST' })
    expect(tags['payments.dispute.outcome']).toBe('LOST')

    errorSpy.mockRestore()
  })
})
