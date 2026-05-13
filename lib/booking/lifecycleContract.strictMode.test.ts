// lib/booking/lifecycleContract.strictMode.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'

import {
  LifecycleViolationError,
  isLifecycleStrictMode,
  recordStatusTransition,
  recordStepTransition,
  registerLifecycleDriftSink,
  type LifecycleDriftEvent,
} from './lifecycleContract'

const ORIGINAL_LIFECYCLE_STRICT_MODE = process.env.LIFECYCLE_STRICT_MODE

const TEST_BOOKING_ID = 'booking_strict_mode_test'
const TEST_PROFESSIONAL_ID = 'pro_strict_mode_test'
const TEST_ROUTE = 'lib/booking/lifecycleContract.strictMode.test.ts'

let unregisterDriftSinks: Array<() => void> = []

function restoreLifecycleStrictModeEnv(): void {
  if (ORIGINAL_LIFECYCLE_STRICT_MODE === undefined) {
    delete process.env.LIFECYCLE_STRICT_MODE
    return
  }

  process.env.LIFECYCLE_STRICT_MODE = ORIGINAL_LIFECYCLE_STRICT_MODE
}

function setLifecycleStrictMode(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.LIFECYCLE_STRICT_MODE
    return
  }

  process.env.LIFECYCLE_STRICT_MODE = value
}

function captureDriftEvents(): LifecycleDriftEvent[] {
  const events: LifecycleDriftEvent[] = []

  const unregister = registerLifecycleDriftSink((event) => {
    events.push(event)
  })

  unregisterDriftSinks.push(unregister)

  return events
}

describe('lib/booking/lifecycleContract strict mode', () => {
  beforeEach(() => {
    unregisterDriftSinks = []
    setLifecycleStrictMode(undefined)
  })

  afterEach(() => {
    for (const unregister of unregisterDriftSinks) {
      unregister()
    }

    unregisterDriftSinks = []
    restoreLifecycleStrictModeEnv()
  })

  it('defaults strict mode off when LIFECYCLE_STRICT_MODE is not set', () => {
    setLifecycleStrictMode(undefined)

    expect(isLifecycleStrictMode()).toBe(false)
  })

  it.each([
    ['1'],
    ['true'],
    ['TRUE'],
    ['yes'],
    [' YES '],
  ])('treats LIFECYCLE_STRICT_MODE=%s as enabled', (value) => {
    setLifecycleStrictMode(value)

    expect(isLifecycleStrictMode()).toBe(true)
  })

  it.each([
    ['0'],
    ['false'],
    ['no'],
    [''],
    ['enabled'],
  ])('treats LIFECYCLE_STRICT_MODE=%s as disabled', (value) => {
    setLifecycleStrictMode(value)

    expect(isLifecycleStrictMode()).toBe(false)
  })

  it('records drift but does not throw for unauthorized status actor when strict mode is off', () => {
    setLifecycleStrictMode(undefined)

    const events = captureDriftEvents()

    expect(() => {
      recordStatusTransition({
        from: BookingStatus.IN_PROGRESS,
        to: BookingStatus.COMPLETED,
        actor: 'CLIENT',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).not.toThrow()

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'UNAUTHORIZED_ACTOR',
      from: BookingStatus.IN_PROGRESS,
      to: BookingStatus.COMPLETED,
      actor: 'CLIENT',
      route: TEST_ROUTE,
      bookingId: TEST_BOOKING_ID,
      professionalId: TEST_PROFESSIONAL_ID,
    })
    expect(events[0]?.reason).toContain(
      'Actor "CLIENT" is not allowed to perform status transition',
    )
  })

  it('throws for unauthorized status actor when strict mode is on', () => {
    setLifecycleStrictMode('true')

    const events = captureDriftEvents()

    expect(() => {
      recordStatusTransition({
        from: BookingStatus.IN_PROGRESS,
        to: BookingStatus.COMPLETED,
        actor: 'CLIENT',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).toThrowError(LifecycleViolationError)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'UNAUTHORIZED_ACTOR',
      from: BookingStatus.IN_PROGRESS,
      to: BookingStatus.COMPLETED,
      actor: 'CLIENT',
      route: TEST_ROUTE,
      bookingId: TEST_BOOKING_ID,
      professionalId: TEST_PROFESSIONAL_ID,
    })
  })

  it('throws for CLIENT attempting AFTER_PHOTOS to DONE when strict mode is on', () => {
    setLifecycleStrictMode('true')

    const events = captureDriftEvents()

    expect(() => {
      recordStepTransition({
        from: SessionStep.AFTER_PHOTOS,
        to: SessionStep.DONE,
        actor: 'CLIENT',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).toThrowError(LifecycleViolationError)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'UNAUTHORIZED_ACTOR',
      from: SessionStep.AFTER_PHOTOS,
      to: SessionStep.DONE,
      actor: 'CLIENT',
      route: TEST_ROUTE,
      bookingId: TEST_BOOKING_ID,
      professionalId: TEST_PROFESSIONAL_ID,
    })
  })

  it('allows SYSTEM to complete checkout-driven status and step transitions under strict mode', () => {
    setLifecycleStrictMode('true')

    const events = captureDriftEvents()

    expect(() => {
      recordStepTransition({
        from: SessionStep.AFTER_PHOTOS,
        to: SessionStep.DONE,
        actor: 'SYSTEM',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })

      recordStatusTransition({
        from: BookingStatus.IN_PROGRESS,
        to: BookingStatus.COMPLETED,
        actor: 'SYSTEM',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).not.toThrow()

    expect(events).toHaveLength(0)
  })

  it('does not emit drift for idempotent same-status or same-step transitions', () => {
    setLifecycleStrictMode('true')

    const events = captureDriftEvents()

    expect(() => {
      recordStepTransition({
        from: SessionStep.AFTER_PHOTOS,
        to: SessionStep.AFTER_PHOTOS,
        actor: 'CLIENT',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })

      recordStatusTransition({
        from: BookingStatus.COMPLETED,
        to: BookingStatus.COMPLETED,
        actor: 'CLIENT',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).not.toThrow()

    expect(events).toHaveLength(0)
  })
})