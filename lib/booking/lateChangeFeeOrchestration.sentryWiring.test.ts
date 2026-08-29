// lib/booking/lateChangeFeeOrchestration.sentryWiring.test.ts
//
// The sibling suite proves captureBookingException is CALLED. That is not the
// same as "an event reaches Sentry", and this repo has already been bitten by
// exactly that gap: before #1034 every server error was logged, rethrown, and
// seen by nobody, because @sentry/nextjs's route-wrapping loader is webpack-only
// and this app builds with Turbopack.
//
// So this suite runs the REAL bookingEvents module against a REAL Sentry client
// with a capturing transport, and asserts an envelope actually leaves — through
// the same beforeSend (scrubSentryEvent) production installs.
//
// Why the Turbopack/onRequestError gap does NOT apply to this path: that fix
// covers UNHANDLED errors, which Next hands to the onRequestError hook. This
// call is an explicit Sentry.captureException on a swallowed error — it never
// reaches Next's error path at all. Its only dependency is Sentry.init having
// run, which instrumentation.ts register() does for NEXT_RUNTIME === 'nodejs'.
// Both callers of runLateChangeFeeOrchestration are node route handlers
// (app/api/v1/bookings/[id]/reschedule and the public token reschedule), not
// build-time scripts, so register() has run before either can execute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus } from '@prisma/client'
import * as Sentry from '@sentry/nextjs'

import { scrubSentryEvent } from '@/lib/observability/sentryConfig'

const mocks = vi.hoisted(() => ({
  assessAndChargeNoShowFee: vi.fn(),
  noShowProtectionEnabled: vi.fn(),
}))

vi.mock('@/lib/noShowProtection/charge', () => ({
  assessAndChargeNoShowFee: mocks.assessAndChargeNoShowFee,
}))

vi.mock('@/lib/noShowProtection/flag', () => ({
  noShowProtectionEnabled: mocks.noShowProtectionEnabled,
}))

// NOTE: bookingEvents is deliberately NOT mocked here.
import { runLateChangeFeeOrchestration } from './lateChangeFeeOrchestration'

const sent: Sentry.Event[] = []
let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  sent.length = 0
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.noShowProtectionEnabled.mockReturnValue(true)

  Sentry.init({
    dsn: 'https://abcdef0123456789abcdef0123456789@o1.ingest.sentry.io/1',
    enabled: true,
    transport: () => ({ send: async () => ({}), flush: async () => true }),
    // The same hook sentry.server.config.ts installs in production.
    beforeSend(event) {
      sent.push(scrubSentryEvent(event))
      return null
    },
  })
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('late-change fee capture reaches Sentry end to end', () => {
  it('emits one tagged, scrubbed event when the fee charge throws', async () => {
    mocks.assessAndChargeNoShowFee.mockRejectedValue(
      new Error('Stripe request failed'),
    )

    await runLateChangeFeeOrchestration({
      bookingId: 'bk_e2e',
      lateChangeApplied: true,
      previousScheduledFor: new Date('2026-08-07T14:00:00.000Z'),
      priorStatus: BookingStatus.ACCEPTED,
      operation: 'PATCH /api/v1/bookings/[id]/reschedule',
    })

    await Sentry.flush(2000)

    expect(sent).toHaveLength(1)
    const event = sent[0]
    if (!event) throw new Error('no Sentry event was sent')

    // It is an EXCEPTION event, not a log — so it alarms regardless of
    // SENTRY_ENABLE_LOGS, which is off by default and stays off.
    expect(event.exception?.values?.[0]?.value).toBe('Stripe request failed')
    expect(event.level).toBe('error')

    // The tags a human needs to route it, surviving beforeSend.
    expect(event.tags).toMatchObject({
      area: 'booking',
      'booking.event': 'LATE_CHANGE_FEE_CHARGE_THREW',
      'booking.route': 'PATCH /api/v1/bookings/[id]/reschedule',
      'booking.id': 'bk_e2e',
    })
  })

  it('sends NOTHING when the charge succeeds', async () => {
    mocks.assessAndChargeNoShowFee.mockResolvedValue({
      kind: 'ATTEMPTED' as const,
      status: 'CHARGED',
      amount: '40.00',
      stripePaymentIntentId: 'pi_1',
      alreadyCharged: false,
    })

    await runLateChangeFeeOrchestration({
      bookingId: 'bk_ok',
      lateChangeApplied: true,
      previousScheduledFor: new Date('2026-08-07T14:00:00.000Z'),
      priorStatus: BookingStatus.ACCEPTED,
      operation: 'PATCH /api/v1/bookings/[id]/reschedule',
    })

    await Sentry.flush(2000)

    expect(sent).toHaveLength(0)
  })
})
