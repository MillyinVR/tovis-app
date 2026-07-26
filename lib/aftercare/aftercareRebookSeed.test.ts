// lib/aftercare/aftercareRebookSeed.test.ts
import {
  BookingStatus,
  ServiceLocationType,
} from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  isActiveAftercareRebookedBooking,
  resolveAftercareRebookSeed,
  type AftercareRebookedBookingSnapshot,
  type AftercareRebookSlotSnapshot,
} from './aftercareRebookSeed'

const SAVED_START = new Date('2026-09-01T17:00:00.000Z')
const SAVED_END = new Date('2026-09-01T18:30:00.000Z')
const MOVED_START = new Date('2026-09-08T20:00:00.000Z')

function makeSlot(
  overrides: Partial<AftercareRebookSlotSnapshot> = {},
): AftercareRebookSlotSnapshot {
  return {
    offeringId: 'offering_1',
    locationId: 'loc_1',
    locationType: ServiceLocationType.SALON,
    clientAddressId: null,
    startsAt: SAVED_START,
    endsAt: SAVED_END,
    ...overrides,
  }
}

function makeBooking(
  overrides: Partial<AftercareRebookedBookingSnapshot> = {},
): AftercareRebookedBookingSnapshot {
  return {
    id: 'booking_next',
    status: BookingStatus.ACCEPTED,
    scheduledFor: SAVED_START,
    locationType: ServiceLocationType.SALON,
    locationId: 'loc_1',
    clientAddressId: null,
    ...overrides,
  }
}

describe('isActiveAftercareRebookedBooking', () => {
  it('counts an appointment that still holds calendar time', () => {
    for (const status of [
      BookingStatus.PENDING,
      BookingStatus.ACCEPTED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED,
    ] as const) {
      expect(isActiveAftercareRebookedBooking({ status })).toBe(true)
    }
  })

  it('ignores an appointment that released its time', () => {
    expect(
      isActiveAftercareRebookedBooking({ status: BookingStatus.CANCELLED }),
    ).toBe(false)
    expect(
      isActiveAftercareRebookedBooking({ status: BookingStatus.NO_SHOW }),
    ).toBe(false)
    expect(isActiveAftercareRebookedBooking(null)).toBe(false)
  })
})

describe('resolveAftercareRebookSeed', () => {
  it('passes the snapshot straight through when the plan never became a booking', () => {
    const slot = makeSlot()

    expect(
      resolveAftercareRebookSeed({
        rebookedFor: SAVED_START,
        slot,
        rebookedBooking: null,
      }),
    ).toEqual({
      rebookedFor: SAVED_START,
      slot,
      rescheduledSinceSaved: false,
    })
  })

  it('ignores a cancelled appointment and keeps the snapshot', () => {
    const slot = makeSlot()

    const seed = resolveAftercareRebookSeed({
      rebookedFor: SAVED_START,
      slot,
      rebookedBooking: makeBooking({
        status: BookingStatus.CANCELLED,
        scheduledFor: MOVED_START,
      }),
    })

    expect(seed.slot?.startsAt).toEqual(SAVED_START)
    expect(seed.rescheduledSinceSaved).toBe(false)
  })

  it('reports no drift while the appointment still sits where it was saved', () => {
    const seed = resolveAftercareRebookSeed({
      rebookedFor: SAVED_START,
      slot: makeSlot(),
      rebookedBooking: makeBooking(),
    })

    expect(seed.rescheduledSinceSaved).toBe(false)
    expect(seed.rebookedFor).toEqual(SAVED_START)
    expect(seed.slot?.startsAt).toEqual(SAVED_START)
    expect(seed.slot?.endsAt).toEqual(SAVED_END)
  })

  it('re-points a rescheduled appointment so an untouched save cannot drag it back', () => {
    // This is the whole point of the module. The pro books 1 Sep, the client
    // moves it to 8 Sep, and weeks later the pro opens the completed aftercare
    // to fix a typo. Seeding the frozen 1 Sep slot would make that notes-only
    // save look like a deliberate time change to the write boundary, which
    // would reschedule the client back to 1 Sep.
    const seed = resolveAftercareRebookSeed({
      rebookedFor: SAVED_START,
      slot: makeSlot(),
      rebookedBooking: makeBooking({ scheduledFor: MOVED_START }),
    })

    expect(seed.rebookedFor).toEqual(MOVED_START)
    expect(seed.slot?.startsAt).toEqual(MOVED_START)
    expect(seed.rescheduledSinceSaved).toBe(true)
  })

  it('preserves the picked slot width when it shifts the start', () => {
    const seed = resolveAftercareRebookSeed({
      rebookedFor: SAVED_START,
      slot: makeSlot(),
      rebookedBooking: makeBooking({ scheduledFor: MOVED_START }),
    })

    expect(
      (seed.slot?.endsAt.getTime() ?? 0) - (seed.slot?.startsAt.getTime() ?? 0),
    ).toBe(SAVED_END.getTime() - SAVED_START.getTime())
  })

  it('carries the offering, which only the snapshot knows', () => {
    // Dropping it would make the boundary refuse the save outright with
    // OFFERING_ID_REQUIRED.
    const seed = resolveAftercareRebookSeed({
      rebookedFor: SAVED_START,
      slot: makeSlot({ offeringId: 'offering_xyz' }),
      rebookedBooking: makeBooking({ scheduledFor: MOVED_START }),
    })

    expect(seed.slot?.offeringId).toBe('offering_xyz')
  })

  it('follows a placement change onto the live appointment', () => {
    const seed = resolveAftercareRebookSeed({
      rebookedFor: SAVED_START,
      slot: makeSlot(),
      rebookedBooking: makeBooking({
        locationType: ServiceLocationType.MOBILE,
        locationId: 'loc_2',
        clientAddressId: 'addr_1',
      }),
    })

    expect(seed.slot?.locationType).toBe(ServiceLocationType.MOBILE)
    expect(seed.slot?.locationId).toBe('loc_2')
    expect(seed.slot?.clientAddressId).toBe('addr_1')
    expect(seed.rescheduledSinceSaved).toBe(true)
  })

  it('never synthesizes a slot from an appointment alone', () => {
    // Without a snapshot there is no offering and no picked width — a slot
    // invented here would be refused by the write boundary.
    const seed = resolveAftercareRebookSeed({
      rebookedFor: null,
      slot: null,
      rebookedBooking: makeBooking({ scheduledFor: MOVED_START }),
    })

    expect(seed.slot).toBeNull()
    expect(seed.rebookedFor).toBeNull()
    expect(seed.rescheduledSinceSaved).toBe(false)
  })
})
