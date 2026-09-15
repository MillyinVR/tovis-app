// lib/notifications/hrefShapes.test.ts
//
// The web half of the notification-href contract.
//
// Three separate things are checked here, and they fail for different reasons
// on purpose:
//
//   1. the MATCHER reduces a concrete href to the right shape (if it were
//      wrong, every other check would be comparing the wrong things);
//   2. every event key's declaration is INTERNALLY consistent — it names
//      registered shapes, and nothing in the registry is orphaned;
//   3. the published fixture tovis-ios drives its parser over is in SYNC with
//      the registry.
//
// What is NOT checked here — and cannot be — is whether the phone actually
// routes any of it. That is a Swift test, because only the Swift parser can
// answer it; a node-side validator asserting "the JSON parses" would be exactly
// the self-agreeing mirror this whole exercise exists to remove.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { NotificationEventKey } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import { NOTIFICATION_EVENT_DEFINITIONS } from './eventKeys'
import {
  NOTIFICATION_HREF_SHAPES,
  notificationHrefShape,
  notificationHrefShapeDefinition,
} from './hrefShapes'
import {
  NOTIFICATION_HREF_FIXTURE_PATH,
  renderNotificationHrefFixture,
} from './hrefShapesFixture'

const definitions = Object.values(NOTIFICATION_EVENT_DEFINITIONS)

describe('notificationHrefShape — the matcher', () => {
  it.each([
    ['/client/bookings/b1', '/client/bookings/{bookingId}'],
    ['/client/bookings/b1?step=overview', '/client/bookings/{bookingId}?step=overview'],
    ['/client/bookings/b1?step=aftercare', '/client/bookings/{bookingId}?step=aftercare'],
    ['/client/bookings/b1?step=consult', '/client/bookings/{bookingId}?step=consult'],
    ['/client/bookings/b1#review', '/client/bookings/{bookingId}#review'],
    ['/client/consult/c1', '/client/consult/{consultSessionId}'],
    ['/client/consult/c1/results', '/client/consult/{consultSessionId}/results'],
    ['/pro/reviews/r1', '/pro/reviews/{reviewId}'],
    ['/pro/reviews#review-r1', '/pro/reviews#review-{reviewId}'],
    ['/client/rebook/tok', '/client/rebook/{token}'],
    ['/admin/professionals/p1', '/admin/professionals/{professionalId}'],
  ])('reduces %s to %s', (href, shape) => {
    expect(notificationHrefShape(href)).toBe(shape)
  })

  // 🔴 The bare shape also matches a href WITH a step, so specificity decides.
  // Get this wrong and `?step=aftercare` silently reduces to the plain booking
  // shape: the registry looks complete, and the step arm is never proven.
  it('prefers the most specific shape when several match', () => {
    expect(notificationHrefShape('/client/bookings/b1?step=aftercare')).toBe(
      '/client/bookings/{bookingId}?step=aftercare',
    )
    expect(notificationHrefShape('/client/referrals?confirm=r1')).toBe(
      '/client/referrals?confirm={referralId}',
    )
  })

  // The last-minute job decorates its href with scheduledFor/source/
  // proTimeZone, none of which any parser reads. Unmentioned query keys are
  // ignored so the shape stays about the DESTINATION.
  it('ignores query keys the shape does not mention', () => {
    expect(
      notificationHrefShape(
        '/offerings/o1?scheduledFor=2026-04-08T12%3A00%3A00.000Z&source=DISCOVERY&openingId=op1&proTimeZone=UTC',
      ),
    ).toBe('/offerings/{offeringId}?openingId={openingId}')
  })

  // …but a query key the shape DOES mention is required. A bare
  // /offerings/{id} has no native counterpart, so it must not borrow one.
  it('refuses a href missing a query key the shape requires', () => {
    expect(notificationHrefShape('/offerings/o1')).toBeNull()
  })

  it.each([
    ['/client/notifications', 'an unregistered client path'],
    ['/pro/nope/1', 'an unregistered pro path'],
    ['/terms', 'a page with no native surface'],
    ['https://evil.example/x', 'anything not rooted at /'],
    ['//evil.example/x', 'a protocol-relative URL'],
    ['//looks/x1', 'a doubled slash that would otherwise collapse onto a real shape'],
    ['/client//bookings/b1', 'a doubled slash mid-path'],
    ['/pro/clients//', 'an empty id segment'],
    ['', 'the empty string'],
  ])('refuses %s (%s)', (href) => {
    expect(notificationHrefShape(href)).toBeNull()
  })
})

describe('the registry', () => {
  it('has no duplicate shapes', () => {
    const shapes = NOTIFICATION_HREF_SHAPES.map((s) => s.shape)
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  // A shape whose `surface` is a guess is worse than no shape, because the iOS
  // test will then assert the guess. Every row argues for itself.
  it('gives every shape a non-empty reason', () => {
    for (const shape of NOTIFICATION_HREF_SHAPES) {
      expect(shape.why.length, shape.shape).toBeGreaterThan(20)
    }
  })

  it('round-trips: every shape matches a href minted from it', () => {
    for (const { shape } of NOTIFICATION_HREF_SHAPES) {
      const href = shape.replace(/\{[^}]+\}/g, 'x1')
      expect(notificationHrefShape(href), shape).toBe(shape)
    }
  })
})

describe('event definitions declare their href shapes', () => {
  it('sanity: covers every NotificationEventKey', () => {
    expect(definitions.length).toBe(Object.keys(NotificationEventKey).length)
  })

  // The declaration is typed to the registry union, so this cannot fail while
  // `tsc` passes — which is the point. It is here so the failure is a readable
  // test rather than only a type error in a 1500-line file.
  it.each(definitions.map((d) => [d.key, d] as const))(
    '%s declares only registered shapes',
    (_key, definition) => {
      for (const shape of definition.hrefShapes) {
        expect(() => notificationHrefShapeDefinition(shape)).not.toThrow()
      }
    },
  )

  // 🔴 This is the control in the "remove a shape iOS routes" direction. Delete
  // a shape from the registry that an event still declares and `tsc` rejects
  // it; delete it from BOTH and this fails, because the registry now carries a
  // row nothing sends — which means tovis-ios is being held to a destination
  // web no longer produces.
  it('has no orphaned shape — every registered shape is declared by some event', () => {
    const declared = new Set(definitions.flatMap((d) => [...d.hrefShapes]))
    const orphaned = NOTIFICATION_HREF_SHAPES.map((s) => s.shape).filter(
      (s) => !declared.has(s),
    )
    expect(orphaned).toEqual([])
  })

  // An event with no href is a real answer (BOOKING_STARTED has no emitter that
  // passes one). It must be written as `[]`, and this asserts the empty set is
  // small and deliberate rather than the default everyone reaches for.
  it('keeps the no-href set small and nameable', () => {
    const none = definitions.filter((d) => d.hrefShapes.length === 0).map((d) => d.key)
    expect(none).toEqual([NotificationEventKey.BOOKING_STARTED])
  })
})

describe('the fixture published to tovis-ios', () => {
  it('is in sync with the registry (regenerate: pnpm gen:notification-href-fixture)', () => {
    const committed = readFileSync(
      resolve(process.cwd(), NOTIFICATION_HREF_FIXTURE_PATH),
      'utf8',
    )
    expect(committed).toBe(renderNotificationHrefFixture())
  })
})
