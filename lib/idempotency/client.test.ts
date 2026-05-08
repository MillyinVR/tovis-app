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
