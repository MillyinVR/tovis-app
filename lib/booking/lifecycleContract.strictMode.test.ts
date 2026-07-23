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

  it('defaults strict mode on when LIFECYCLE_STRICT_MODE is not set', () => {
    setLifecycleStrictMode(undefined)

    expect(isLifecycleStrictMode()).toBe(true)
  })

  it.each([
    ['1'],
    ['true'],
    ['TRUE'],
    ['yes'],
    [' YES '],
    ['enabled'],
  ])('treats LIFECYCLE_STRICT_MODE=%s as enabled', (value) => {
    setLifecycleStrictMode(value)

    expect(isLifecycleStrictMode()).toBe(true)
  })

  it.each([
    ['0'],
    ['false'],
    ['no'],
    ['off'],
    [''],
  ])('treats LIFECYCLE_STRICT_MODE=%s as disabled', (value) => {
    setLifecycleStrictMode(value)

    expect(isLifecycleStrictMode()).toBe(false)
  })

  it('records drift but does not throw for unauthorized status actor when strict mode is off', () => {
    setLifecycleStrictMode('false')

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

// M8 — the cancel & closeout transitions the write boundary routes through the
// contract. These pin the contract shape the boundary now depends on (SYSTEM
// auto-release is legal; a client/pro cancel of a started session is not; a late
// payment can never drag a terminal booking to COMPLETED).
describe('lib/booking/lifecycleContract — M8 cancel & closeout coverage', () => {
  beforeEach(() => {
    unregisterDriftSinks = []
    setLifecycleStrictMode('true')
  })

  afterEach(() => {
    for (const unregister of unregisterDriftSinks) {
      unregister()
    }
    unregisterDriftSinks = []
    restoreLifecycleStrictModeEnv()
  })

  // SYSTEM auto-cancels (M5 unpaid-deposit release + pristine import cleanup) are
  // legal from the two occupying pre-session statuses.
  it.each([[BookingStatus.PENDING], [BookingStatus.ACCEPTED]])(
    'allows SYSTEM to cancel a %s booking (auto-release) without drift',
    (from) => {
      const events = captureDriftEvents()

      expect(() => {
        recordStatusTransition({
          from,
          to: BookingStatus.CANCELLED,
          actor: 'SYSTEM',
          route: TEST_ROUTE,
          bookingId: TEST_BOOKING_ID,
          professionalId: TEST_PROFESSIONAL_ID,
        })
      }).not.toThrow()

      expect(events).toHaveLength(0)
    },
  )

  // A started session (IN_PROGRESS) may only be cancelled by ADMIN — a client
  // (the reachable iOS bypass), pro, or the system are all refused.
  it.each([['CLIENT'], ['PRO'], ['SYSTEM']] as const)(
    'refuses %s cancelling a started IN_PROGRESS booking',
    (actor) => {
      const events = captureDriftEvents()

      expect(() => {
        recordStatusTransition({
          from: BookingStatus.IN_PROGRESS,
          to: BookingStatus.CANCELLED,
          actor,
          route: TEST_ROUTE,
          bookingId: TEST_BOOKING_ID,
          professionalId: TEST_PROFESSIONAL_ID,
        })
      }).toThrowError(LifecycleViolationError)

      expect(events).toHaveLength(1)
      expect(events[0]?.from).toBe(BookingStatus.IN_PROGRESS)
      expect(events[0]?.to).toBe(BookingStatus.CANCELLED)
    },
  )

  it('allows ADMIN to cancel a started IN_PROGRESS booking without drift', () => {
    const events = captureDriftEvents()

    expect(() => {
      recordStatusTransition({
        from: BookingStatus.IN_PROGRESS,
        to: BookingStatus.CANCELLED,
        actor: 'ADMIN',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).not.toThrow()

    expect(events).toHaveLength(0)
  })

  // M1 tie-in at the contract layer: there is no transition INTO COMPLETED from a
  // terminal status, so a late-arriving payment can never complete a CANCELLED or
  // NO_SHOW booking even if the closeout predicate were somehow bypassed.
  it.each([[BookingStatus.CANCELLED], [BookingStatus.NO_SHOW]])(
    'refuses SYSTEM completing a %s booking (late payment cannot drag it to COMPLETED)',
    (from) => {
      const events = captureDriftEvents()

      expect(() => {
        recordStatusTransition({
          from,
          to: BookingStatus.COMPLETED,
          actor: 'SYSTEM',
          route: TEST_ROUTE,
          bookingId: TEST_BOOKING_ID,
          professionalId: TEST_PROFESSIONAL_ID,
        })
      }).toThrowError(LifecycleViolationError)

      expect(events).toHaveLength(1)
    },
  )

  // NO_SHOW is terminal (revenue protection): nothing may cancel it back out.
  it('refuses cancelling a NO_SHOW booking (terminal)', () => {
    const events = captureDriftEvents()

    expect(() => {
      recordStatusTransition({
        from: BookingStatus.NO_SHOW,
        to: BookingStatus.CANCELLED,
        actor: 'ADMIN',
        route: TEST_ROUTE,
        bookingId: TEST_BOOKING_ID,
        professionalId: TEST_PROFESSIONAL_ID,
      })
    }).toThrowError(LifecycleViolationError)

    expect(events).toHaveLength(1)
  })
})
