// lib/idempotency/client.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildClientIdempotencyKey } from './client'

describe('buildClientIdempotencyKey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('produces the same key for the same inputs within the same time bucket', () => {
    const args = {
      scope: 'client-checkout-stripe-session',
      entityId: 'booking_1',
      action: 'create-stripe-session',
    }

    const a = buildClientIdempotencyKey(args)

    vi.setSystemTime(new Date('2026-05-07T12:00:30.000Z')) // +30s
    const b = buildClientIdempotencyKey(args)

    expect(a).toBe(b)
  })

  it('produces a different key after the bucket window elapses', () => {
    const args = {
      scope: 'client-checkout-stripe-session',
      entityId: 'booking_1',
      action: 'create-stripe-session',
    }

    const a = buildClientIdempotencyKey(args)

    vi.setSystemTime(new Date('2026-05-07T12:01:01.000Z')) // +61s, past 60s default
    const b = buildClientIdempotencyKey(args)

    expect(a).not.toBe(b)
  })

  it('produces different keys for different actions in the same bucket', () => {
    const a = buildClientIdempotencyKey({
      scope: 'client-checkout',
      entityId: 'booking_1',
      action: 'save-tip',
    })

    const b = buildClientIdempotencyKey({
      scope: 'client-checkout',
      entityId: 'booking_1',
      action: 'confirm-payment',
    })

    expect(a).not.toBe(b)
  })

  it('produces different keys for different entityIds in the same bucket', () => {
    const a = buildClientIdempotencyKey({
      scope: 'client-checkout',
      entityId: 'booking_1',
    })

    const b = buildClientIdempotencyKey({
      scope: 'client-checkout',
      entityId: 'booking_2',
    })

    expect(a).not.toBe(b)
  })

  it('produces different keys when nonce differs', () => {
    const a = buildClientIdempotencyKey({
      scope: 'client-checkout',
      entityId: 'booking_1',
      nonce: 'n1',
    })

    const b = buildClientIdempotencyKey({
      scope: 'client-checkout',
      entityId: 'booking_1',
      nonce: 'n2',
    })

    expect(a).not.toBe(b)
  })

  it('honours a custom bucketMs', () => {
    const args = {
      scope: 's',
      entityId: 'e',
      action: 'a',
      bucketMs: 5_000,
    }

    const a = buildClientIdempotencyKey(args)

    vi.setSystemTime(new Date('2026-05-07T12:00:04.000Z')) // +4s, still in 5s bucket
    expect(buildClientIdempotencyKey(args)).toBe(a)

    vi.setSystemTime(new Date('2026-05-07T12:00:06.000Z')) // +6s, new bucket
    expect(buildClientIdempotencyKey(args)).not.toBe(a)
  })

  it('throws when scope or entityId is empty', () => {
    expect(() =>
      buildClientIdempotencyKey({ scope: '', entityId: 'x' }),
    ).toThrow()
    expect(() =>
      buildClientIdempotencyKey({ scope: 'x', entityId: '' }),
    ).toThrow()
  })
})

// The converted call sites (the 5 hand-rolled UUID builders + the 5 other
// hand-rolled sites found alongside them). Several of these POST/PATCH the
// SAME endpoint from different surfaces, so their scope/action triples must
// never collide for one booking within a bucket.
describe('converted call-site key namespace', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const ENTITY = 'booking_1'

  const CALL_SITES: Array<{ site: string; scope: string; action: string }> = [
    { site: 'MoneyTrailInspector refund', scope: 'money-trail', action: 'refund' },
    { site: 'MoneyTrailInspector waive', scope: 'money-trail', action: 'waive' },
    { site: 'BookingActions accept', scope: 'booking-lifecycle', action: 'ACCEPT' },
    { site: 'BookingActions cancel', scope: 'booking-lifecycle', action: 'CANCEL' },
    { site: 'BookingActions no-show', scope: 'booking-lifecycle', action: 'NO_SHOW' },
    // Client-side lifecycle actions — these two sent NO key at all before this
    // consolidation, so both routes 400'd IDEMPOTENCY_KEY_REQUIRED.
    { site: 'client BookingActions cancel', scope: 'booking-lifecycle', action: 'CLIENT_CANCEL' },
    { site: 'client reschedule confirm', scope: 'booking-lifecycle', action: 'CLIENT_RESCHEDULE' },
    { site: 'useProSession start', scope: 'pro-session', action: 'start' },
    { site: 'useProSession finish', scope: 'pro-session', action: 'finish' },
    { site: 'useConfirmChange apply', scope: 'pro-calendar-change', action: 'apply' },
    { site: 'useBookingModal reschedule', scope: 'pro-booking-modal', action: 'reschedule' },
    { site: 'useBookingModal accept', scope: 'pro-booking-modal', action: 'ACCEPTED' },
    { site: 'useBookingModal session start', scope: 'pro-booking-modal', action: 'session-start' },
    { site: 'useManagementPanel accept', scope: 'pro-calendar-management', action: 'ACCEPTED' },
    { site: 'useManagementPanel cancel', scope: 'pro-calendar-management', action: 'CANCELLED' },
    { site: 'ShareLookSheet submit', scope: 'share-look', action: 'submit' },
    { site: 'CompletePaymentCard checkout', scope: 'public-rebook', action: 'checkout' },
    { site: 'RebookCard book', scope: 'public-rebook', action: 'book' },
    { site: 'consultation approve', scope: 'public-consultation', action: 'APPROVE' },
    { site: 'consultation reject', scope: 'public-consultation', action: 'REJECT' },
    { site: 'NewBookingForm create', scope: 'pro-booking-create', action: 'create' },
  ]

  it('every converted call site yields a distinct key for one entity + bucket', () => {
    const seen = new Map<string, string>()

    for (const { site, scope, action } of CALL_SITES) {
      // Nonce-bearing sites still collapse to their triple when the body is
      // identical, so comparing the no-nonce form is the strict worst case.
      const key = buildClientIdempotencyKey({ scope, entityId: ENTITY, action })

      const clash = seen.get(key)
      expect(
        clash,
        `${site} collides with ${clash ?? ''} — same key, different intent`,
      ).toBeUndefined()

      seen.set(key, site)
    }

    expect(seen.size).toBe(CALL_SITES.length)
  })

  it('a body-derived nonce splits genuinely different submissions', () => {
    // The iterative/body-varying sites (calendar patches, new booking, share
    // look, rebook) pass the serialized body as the nonce.
    const base = {
      scope: 'pro-calendar-change',
      entityId: ENTITY,
      action: 'apply',
    }

    const move = buildClientIdempotencyKey({
      ...base,
      nonce: JSON.stringify({ scheduledFor: '2026-06-12T16:00:00.000Z' }),
    })
    const sameMoveAgain = buildClientIdempotencyKey({
      ...base,
      nonce: JSON.stringify({ scheduledFor: '2026-06-12T16:00:00.000Z' }),
    })
    const overrideRetry = buildClientIdempotencyKey({
      ...base,
      nonce: JSON.stringify({
        scheduledFor: '2026-06-12T16:00:00.000Z',
        allowShortNotice: true,
      }),
    })

    // Double-click of the same intent ⇒ replay.
    expect(sameMoveAgain).toBe(move)
    // Changed body (override flags added) ⇒ fresh key, so no 409.
    expect(overrideRetry).not.toBe(move)
  })
})
