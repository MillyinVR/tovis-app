// lib/notifications/hrefShapeGuard.test.ts
//
// The guard is what makes the declarations in `eventKeys.ts` worth anything —
// without it they are unchecked claims about what the emitters do. So its own
// behaviour is pinned here, INCLUDING the production branch, which no other
// test exercises (the suite runs with NODE_ENV=test, so every other test only
// ever sees the throwing path).

import { NotificationEventKey } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertNotificationHrefShape,
  NOTIFICATION_HREF_SHAPE_WARNING,
} from './hrefShapeGuard'

const captureNotificationException = vi.hoisted(() => vi.fn())
vi.mock('@/lib/observability/notificationEvents', () => ({
  captureNotificationException,
}))

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

afterEach(() => {
  vi.unstubAllEnvs()
  captureNotificationException.mockReset()
  expect(process.env.NODE_ENV).toBe(ORIGINAL_NODE_ENV)
})

describe('assertNotificationHrefShape — outside production', () => {
  it('sanity: the suite runs where the guard throws', () => {
    expect(process.env.NODE_ENV).not.toBe('production')
  })

  it('returns a declared href unchanged', () => {
    const href = '/pro/clients/client_1'
    expect(
      assertNotificationHrefShape(NotificationEventKey.CHART_ACCESS_GRANTED, href),
    ).toBe(href)
  })

  it('accepts every variant an event declares', () => {
    for (const href of [
      '/client/bookings/b1',
      '/client/bookings/b1?step=overview',
      '/pro/bookings/b1',
    ]) {
      expect(
        assertNotificationHrefShape(NotificationEventKey.BOOKING_CONFIRMED, href),
      ).toBe(href)
    }
  })

  // An empty href means "this row has no destination", which is also what
  // `normInternalHref` returns for anything it rejects. Never a failure.
  it('allows an empty href', () => {
    expect(
      assertNotificationHrefShape(NotificationEventKey.BOOKING_STARTED, ''),
    ).toBe('')
  })

  it('throws on an href that matches no registered shape', () => {
    expect(() =>
      assertNotificationHrefShape(
        NotificationEventKey.APPOINTMENT_REMINDER,
        '/client/notifications',
      ),
    ).toThrow(/matches no shape in the registry/)
  })

  // 🔴 The sharper half. The href is a perfectly good shape — just not one THIS
  // event sends. Without this, a registry-wide allowlist would let any event
  // emit any href, and the per-event declarations would be decorative.
  it('throws on a registered shape the event does not declare', () => {
    expect(() =>
      assertNotificationHrefShape(
        NotificationEventKey.CHART_ACCESS_GRANTED,
        '/pro/waitlist',
      ),
    ).toThrow(/reduces to \/pro\/waitlist, which this event does not declare/)
  })

  it('names the href and the fix in the message', () => {
    try {
      assertNotificationHrefShape(
        NotificationEventKey.LOOK_LIKED,
        '/client/loyalty/x1',
      )
      expect.unreachable('should have thrown')
    } catch (error) {
      const text = (error as Error).message
      // The tag every one of these carries, in a thrown message and in Sentry
      // alike — pinned so it stays a stable thing to search for.
      expect(text).toContain(NOTIFICATION_HREF_SHAPE_WARNING)
      expect(text).toContain('LOOK_LIKED')
      expect(text).toContain('/client/loyalty/x1')
      expect(text).toContain('gen:notification-href-fixture')
    }
  })

  it('does not report to Sentry when it throws', () => {
    expect(() =>
      assertNotificationHrefShape(NotificationEventKey.LOOK_LIKED, '/nope/x1'),
    ).toThrow()
    expect(captureNotificationException).not.toHaveBeenCalled()
  })
})

// 🔴 The branch that runs in prod, and therefore the one nothing else covers.
//
// It must NOT throw: a notification failing to send because its destination is
// undeclared would be far worse than the dead tap this mechanism prevents, and
// the href has already been sanitized by `normInternalHref` regardless.
//
// Note this is the branch a Vercel PREVIEW takes too — preview builds are
// NODE_ENV=production. The test suite, not the preview, is the line of defence.
describe('assertNotificationHrefShape — in production', () => {
  it('reports instead of throwing, and still returns the href', () => {
    vi.stubEnv('NODE_ENV', 'production')

    const href = '/client/notifications'
    expect(
      assertNotificationHrefShape(NotificationEventKey.APPOINTMENT_REMINDER, href),
    ).toBe(href)

    expect(captureNotificationException).toHaveBeenCalledTimes(1)
    const call = captureNotificationException.mock.calls[0]?.[0]
    expect(call.level).toBe('warning')
    expect(call.event).toBe(NotificationEventKey.APPOINTMENT_REMINDER)
    expect(call.route).toBe('notifications/hrefShapeGuard')
    expect((call.error as Error).message).toContain('/client/notifications')
    expect((call.error as Error).message).toContain(NOTIFICATION_HREF_SHAPE_WARNING)
  })

  it('stays silent for a declared href', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(
      assertNotificationHrefShape(
        NotificationEventKey.CHART_ACCESS_GRANTED,
        '/pro/clients/c1',
      ),
    ).toBe('/pro/clients/c1')
    expect(captureNotificationException).not.toHaveBeenCalled()
  })
})
