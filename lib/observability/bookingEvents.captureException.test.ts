// lib/observability/bookingEvents.captureException.test.ts
//
// captureBookingException has ~60 call sites across the booking and money
// domains and, until the money/booking console triage, no direct test. The
// triage added an optional `level`, so what needs proving is BOTH that the new
// severity reaches a real Sentry event AND that omitting it leaves the ~60
// existing callers exactly where they were.
//
// Run against a real Sentry client with a capturing transport and the same
// beforeSend (scrubSentryEvent) production installs — a mocked SDK would assert
// only that the function was called, which is the gap #1034 was about.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/nextjs'

import { captureBookingException } from '@/lib/observability/bookingEvents'
import { scrubSentryEvent } from '@/lib/observability/sentryConfig'

const sent: Sentry.Event[] = []

beforeEach(() => {
  sent.length = 0
  Sentry.init({
    dsn: 'https://abcdef0123456789abcdef0123456789@o1.ingest.sentry.io/1',
    enabled: true,
    transport: () => ({ send: async () => ({}), flush: async () => true }),
    beforeSend(event) {
      sent.push(scrubSentryEvent(event))
      return null
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function captureAndFlush(
  input: Parameters<typeof captureBookingException>[0],
): Promise<Sentry.Event> {
  captureBookingException(input)
  await Sentry.flush(2000)

  expect(sent).toHaveLength(1)
  const event = sent[0]
  if (!event) throw new Error('no Sentry event was sent')
  return event
}

describe('captureBookingException severity', () => {
  // The regression guard for the ~60 pre-existing callers: none of them pass a
  // level, and every one of them was an 'error' before. Sentry's own default
  // for captureException is 'error', so this asserts the explicit setLevel the
  // triage added did not quietly move them.
  it('defaults to error when no level is passed', async () => {
    const event = await captureAndFlush({
      error: new Error('boom'),
      route: 'legacy-caller',
    })

    expect(event.level).toBe('error')
    expect(event.tags).toMatchObject({ area: 'booking', 'booking.route': 'legacy-caller' })
  })

  it('emits a warning-level event when level is warning', async () => {
    const event = await captureAndFlush({
      error: new Error('delivery enqueue failed'),
      route: 'updateProBooking',
      event: 'APPOINTMENT_TIMEZONE_UNRESOLVABLE',
      level: 'warning',
      bookingId: 'bk_1',
      professionalId: 'pro_1',
      clientId: 'cl_1',
    })

    expect(event.level).toBe('warning')
    expect(event.exception?.values?.[0]?.value).toBe('delivery enqueue failed')
    expect(event.tags).toMatchObject({
      area: 'booking',
      'booking.route': 'updateProBooking',
      'booking.event': 'APPOINTMENT_TIMEZONE_UNRESOLVABLE',
      'booking.id': 'bk_1',
      'booking.professionalId': 'pro_1',
      'booking.clientId': 'cl_1',
    })
  })

  // ⚠️ CANARY — this pins behaviour that is surprising, PRE-EXISTING, and not
  // fixed here, so that nobody rediscovers it the hard way in an incident.
  //
  // beforeSend's SENSITIVE_STRING_PATTERNS wipes any string containing the
  // literal word "aftercare" or "consultation" (the pattern exists to catch
  // private media paths and cannot tell a path from a route name). Because it
  // scans VALUES anywhere in the event, that takes out the message AND the
  // booking.route / booking.event tags — the two things a human triages on.
  //
  // This is not hypothetical and not introduced by the console triage: eight
  // route files that already call captureBookingException live under
  // /aftercare/ or /consultation/ and have been sending a redacted route tag
  // all along. What still survives is the ids, the level, `area: booking`, and
  // — decisively — the ORIGINAL error's stack trace, which is what Sentry
  // groups on and what names the culprit file and line. So these captures are
  // degraded, not blind.
  //
  // Narrowing the pattern means editing a privacy control that also governs
  // audit-log redaction, so it is Tori's call, not a side effect of this PR.
  // If it is ever narrowed, this test turns red and the decision gets re-read
  // on purpose.
  it('CANARY: redacts message AND route/event tags when they contain "aftercare"', async () => {
    const event = await captureAndFlush({
      error: new Error('aftercare access delivery could not be queued'),
      route: 'upsertBookingAftercare',
      event: 'AFTERCARE_ACCESS_DELIVERY_ENQUEUE_FAILED',
      level: 'warning',
      bookingId: 'bk_2',
    })

    expect(event.exception?.values?.[0]?.value).toBe('[REDACTED]')
    expect(event.tags).toMatchObject({
      'booking.route': '[REDACTED]',
      'booking.event': '[REDACTED]',
    })

    // What a human can still triage on.
    expect(event.level).toBe('warning')
    expect(event.tags).toMatchObject({ area: 'booking', 'booking.id': 'bk_2' })
  })

  // A non-Error throw still has to arrive as an exception, not vanish.
  it('wraps a non-Error throw', async () => {
    const event = await captureAndFlush({
      error: 'a string was thrown',
      route: 'some-route',
    })

    expect(event.exception?.values?.[0]?.value).toBe('a string was thrown')
  })

  // beforeSend is the live privacy control, so a capture carrying PII in its
  // message must not reach Sentry with it intact.
  it('is scrubbed by beforeSend when the error message carries PII', async () => {
    const event = await captureAndFlush({
      error: new Error('No such customer: client@example.com'),
      route: 'some-route',
    })

    expect(event.exception?.values?.[0]?.value).not.toContain('client@example.com')
  })
})
