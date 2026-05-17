// lib/booking/overlapPolicy.test.ts

import { ServiceLocationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  aftercareSlotMatchesRequestedWindow,
  bookingStartsMatch,
  decideBookingOverlapPermission,
  type BookingOverlapActor,
  type BookingOverlapSource,
  type BookingWindow,
  type ProPreselectedAftercareSlot,
  type SchedulingConflict,
} from './overlapPolicy'

const startsAt = new Date('2026-06-01T17:00:00.000Z')
const endsAt = new Date('2026-06-01T18:00:00.000Z')

const requestedWindow: BookingWindow = {
  professionalId: 'pro_1',
  startsAt,
  endsAt,
}

const clientActor: BookingOverlapActor = {
  kind: 'CLIENT',
  userId: 'user_client_1',
  clientId: 'client_1',
}

const proActor: BookingOverlapActor = {
  kind: 'PRO',
  userId: 'user_pro_1',
  professionalId: 'pro_1',
}

const adminActor: BookingOverlapActor = {
  kind: 'ADMIN',
  userId: 'user_admin_1',
}

const conflict: SchedulingConflict = {
  kind: 'BOOKING',
  id: 'booking_conflict_1',
  professionalId: 'pro_1',
  startsAt: new Date('2026-06-01T17:30:00.000Z'),
  endsAt: new Date('2026-06-01T18:30:00.000Z'),
}

const broadDiscoverySource: BookingOverlapSource = {
  kind: 'BROAD_DISCOVERY',
}

function makeAftercareSlot(
  overrides: Partial<ProPreselectedAftercareSlot> = {},
): ProPreselectedAftercareSlot {
  return {
    aftercareSummaryId: 'aftercare_1',
    clientActionTokenId: 'token_1',
    professionalId: 'pro_1',
    offeringId: 'offering_1',
    locationId: 'location_1',
    locationType: ServiceLocationType.SALON,
    startsAt,
    endsAt,
    ...overrides,
  }
}

describe('bookingStartsMatch', () => {
  it('returns true when exact times match', () => {
    expect(bookingStartsMatch(startsAt, new Date(startsAt))).toBe(true)
  })

  it('returns false when times differ', () => {
    expect(
      bookingStartsMatch(
        startsAt,
        new Date('2026-06-01T17:15:00.000Z'),
      ),
    ).toBe(false)
  })
})

describe('aftercareSlotMatchesRequestedWindow', () => {
  it('returns true when the requested window matches the pro-preselected aftercare slot', () => {
    expect(
      aftercareSlotMatchesRequestedWindow({
        requestedWindow,
        slot: makeAftercareSlot(),
      }),
    ).toBe(true)
  })

  it('returns false when the requested start differs from the aftercare slot', () => {
    expect(
      aftercareSlotMatchesRequestedWindow({
        requestedWindow,
        slot: makeAftercareSlot({
          startsAt: new Date('2026-06-01T19:00:00.000Z'),
        }),
      }),
    ).toBe(false)
  })

  it('returns false when the requested end differs from the aftercare slot', () => {
    expect(
      aftercareSlotMatchesRequestedWindow({
        requestedWindow,
        slot: makeAftercareSlot({
          endsAt: new Date('2026-06-01T18:30:00.000Z'),
        }),
      }),
    ).toBe(false)
  })

  it('returns false when the requested professional differs from the aftercare slot', () => {
    expect(
      aftercareSlotMatchesRequestedWindow({
        requestedWindow,
        slot: makeAftercareSlot({
          professionalId: 'pro_2',
        }),
      }),
    ).toBe(false)
  })
})

describe('decideBookingOverlapPermission', () => {
  it('allows a normal client booking when there is no conflict', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow,
      conflicts: [],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts: [],
    })
  })

  it('blocks a normal client booking when there is a conflict', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('CLIENT_OVERLAP_NOT_ALLOWED')
      expect(decision.conflicts).toEqual([conflict])
    }
  })

  it('allows a pro-created overlapping booking', () => {
    const decision = decideBookingOverlapPermission({
      actor: proActor,
      source: { kind: 'PRO_CREATED' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'PRO_AUTHORIZED_OVERLAP',
      conflicts: [conflict],
    })
  })

  it('allows an admin override overlapping booking', () => {
    const decision = decideBookingOverlapPermission({
      actor: adminActor,
      source: { kind: 'ADMIN_OVERRIDE' },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'ADMIN_AUTHORIZED_OVERLAP',
      conflicts: [conflict],
    })
  })

  it('allows an aftercare rebook overlap when the pro-preselected window exactly matches', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot(),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision).toEqual({
      ok: true,
      mode: 'AFTERCARE_PRESELECTED_SLOT',
      conflicts: [conflict],
    })
  })

  it('blocks an aftercare rebook overlap when no preselected slot exists', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: null,
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_REQUIRED')
    }
  })

  it('blocks an aftercare rebook overlap when the preselected slot has a different start', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot({
          startsAt: new Date('2026-06-01T18:00:00.000Z'),
        }),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
    }
  })

  it('blocks an aftercare rebook overlap when the preselected slot has a different end', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot({
          endsAt: new Date('2026-06-01T18:30:00.000Z'),
        }),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
    }
  })

  it('blocks an aftercare rebook overlap when the preselected slot belongs to another pro', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: {
        kind: 'AFTERCARE_REBOOK',
        aftercareSummaryId: 'aftercare_1',
        clientActionTokenId: 'token_1',
        proPreselectedSlot: makeAftercareSlot({
          professionalId: 'pro_2',
        }),
      },
      requestedWindow,
      conflicts: [conflict],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('AFTERCARE_PRESELECTED_SLOT_MISMATCH')
    }
  })

  it('blocks an invalid booking window', () => {
    const decision = decideBookingOverlapPermission({
      actor: clientActor,
      source: broadDiscoverySource,
      requestedWindow: {
        professionalId: 'pro_1',
        startsAt: new Date('2026-06-01T18:00:00.000Z'),
        endsAt: new Date('2026-06-01T18:00:00.000Z'),
      },
      conflicts: [],
    })

    expect(decision.ok).toBe(false)

    if (!decision.ok) {
      expect(decision.code).toBe('INVALID_BOOKING_WINDOW')
    }
  })
})