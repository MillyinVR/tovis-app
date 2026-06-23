// lib/proSession/sessionFlow.test.ts
import { describe, expect, it } from 'vitest'
import { SessionStep } from '@prisma/client'

import { getSessionCenterState } from './sessionFlow'

const BOOKING_ID = 'booking_1'

describe('getSessionCenterState', () => {
  it('returns disabled Start for idle mode', () => {
    expect(
      getSessionCenterState({
        mode: 'IDLE',
        bookingId: null,
        sessionStep: null,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Start',
      action: 'NONE',
      href: null,
    })
  })

  it('returns picker action when multiple upcoming bookings are eligible', () => {
    expect(
      getSessionCenterState({
        mode: 'UPCOMING_PICKER',
        bookingId: BOOKING_ID,
        sessionStep: null,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Choose booking',
      action: 'PICK_BOOKING',
      href: null,
    })
  })

  it('returns start action for one upcoming booking', () => {
    expect(
      getSessionCenterState({
        mode: 'UPCOMING',
        bookingId: BOOKING_ID,
        sessionStep: null,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Start',
      action: 'START',
      href: '/pro/bookings/booking_1/session',
    })
  })

  it('routes not-started active bookings to consultation', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.NONE,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Consult',
      action: 'NAVIGATE',
      href: '/pro/bookings/booking_1/session',
    })
  })

  it('routes consultation bookings to the session hub', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.CONSULTATION,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Consult',
      action: 'NAVIGATE',
      href: '/pro/bookings/booking_1/session',
    })
  })

  it('sends pending client consultation to the before camera', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Before photos',
      action: 'CAPTURE_BEFORE',
      href: '/pro/bookings/booking_1/session/before-photos',
    })
  })

  it('sends before-photo step without media to before camera', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.BEFORE_PHOTOS,
        hasBeforeMedia: false,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Before photos',
      action: 'CAPTURE_BEFORE',
      href: '/pro/bookings/booking_1/session/before-photos',
    })
  })

  it('sends before-photo step with media back to session hub', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.BEFORE_PHOTOS,
        hasBeforeMedia: true,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Start service',
      action: 'NAVIGATE',
      href: '/pro/bookings/booking_1/session',
    })
  })

  it('uses finish action while service is in progress', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.SERVICE_IN_PROGRESS,
        hasBeforeMedia: true,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'Finish service',
      action: 'FINISH',
      href: null,
    })
  })

  it('sends a (transient) finish-review booking to the after camera', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.FINISH_REVIEW,
        hasBeforeMedia: true,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'After photos',
      action: 'CAPTURE_AFTER',
      href: '/pro/bookings/booking_1/session/after-photos',
    })
  })

  it('sends after-photo step without media to after camera', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.AFTER_PHOTOS,
        hasBeforeMedia: true,
        hasAfterMedia: false,
      }),
    ).toEqual({
      label: 'After photos',
      action: 'CAPTURE_AFTER',
      href: '/pro/bookings/booking_1/session/after-photos',
    })
  })

  it('sends after-photo step with media to the aftercare summary', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.AFTER_PHOTOS,
        hasBeforeMedia: true,
        hasAfterMedia: true,
      }),
    ).toEqual({
      label: 'Aftercare',
      action: 'NAVIGATE',
      href: '/pro/bookings/booking_1/aftercare',
    })
  })

  it('routes done bookings to aftercare', () => {
    expect(
      getSessionCenterState({
        mode: 'ACTIVE',
        bookingId: BOOKING_ID,
        sessionStep: SessionStep.DONE,
        hasBeforeMedia: true,
        hasAfterMedia: true,
      }),
    ).toEqual({
      label: 'Aftercare',
      action: 'NAVIGATE',
      href: '/pro/bookings/booking_1/aftercare',
    })
  })
})