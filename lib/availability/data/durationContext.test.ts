import { ServiceLocationType } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  resolveDurationWithAddOns: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: mocks.bookingFindUnique },
  },
}))

vi.mock('@/lib/availability/data/addOnContext', () => ({
  resolveDurationWithAddOns: mocks.resolveDurationWithAddOns,
}))

import { resolveAvailabilityDurationMinutes } from './durationContext'

const BASE_ARGS = {
  professionalId: 'pro_1',
  offeringId: 'off_1',
  addOnIds: [] as string[],
  locationType: ServiceLocationType.SALON,
  baseDurationMinutes: 60,
  reschedule: null,
}

const REBOOK_OF = {
  bookingId: 'bk_src',
  owner: { kind: 'PRO' as const, professionalId: 'pro_1' },
}

/** A completed salon booking: base 60 + two add-ons (45, 30) = 135 committed. */
function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'cl_1',
    professionalId: 'pro_1',
    locationType: ServiceLocationType.SALON,
    totalDurationMinutes: 135,
    serviceItems: [
      { durationMinutesSnapshot: 60 },
      { durationMinutesSnapshot: 45 },
      { durationMinutesSnapshot: 30 },
    ],
    ...overrides,
  }
}

describe('resolveAvailabilityDurationMinutes — rebookOf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.bookingFindUnique.mockResolvedValue(sourceRow())
  })

  // The heart of the fix: the rebook commit CLONES the source booking's items,
  // so the offer must be clone-wide, not offering-base wide. With add-ons on
  // the original, base-width counting lit up days the commit doesn't fit.
  it('sizes a same-mode rebook from the source items, not the offering base', async () => {
    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      rebookOf: REBOOK_OF,
    })

    expect(result).toEqual({ ok: true, durationMinutes: 135 })
    expect(mocks.resolveDurationWithAddOns).not.toHaveBeenCalled()
  })

  // Mirrors the commit's fallback: a snapshot-less item counts as 60 minutes.
  it('counts a snapshot-less item as 60 minutes, like the commit does', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      sourceRow({
        serviceItems: [
          { durationMinutesSnapshot: 90 },
          { durationMinutesSnapshot: null },
        ],
      }),
    )

    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      rebookOf: REBOOK_OF,
    })

    expect(result).toEqual({ ok: true, durationMinutes: 150 })
  })

  // Anti-enumeration: someone else's booking and a missing booking answer
  // identically — the same rule the reschedule context follows.
  it('answers BOOKING_NOT_FOUND for another pro’s booking', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      sourceRow({ professionalId: 'pro_other' }),
    )

    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      rebookOf: REBOOK_OF,
    })

    expect(result).toEqual({ ok: false, code: 'BOOKING_NOT_FOUND' })
  })

  it('refuses separate add-ons — the clone already carries the source’s', async () => {
    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      addOnIds: ['ao_1'],
      rebookOf: REBOOK_OF,
    })

    expect(result).toMatchObject({ ok: false, code: 'ADDONS_INVALID' })
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })

  // The commit refuses to switch in-person/mobile on a multi-item rebook, so
  // the offer must refuse too instead of counting for a save that will fail.
  it('refuses a mode switch on a multi-item source, like the commit does', async () => {
    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      locationType: ServiceLocationType.MOBILE,
      rebookOf: REBOOK_OF,
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_SERVICE_ITEMS' })
  })

  // A single-item mode switch re-derives from the live offering for the
  // requested mode — the commit's isLocationOverride branch.
  it('sizes a single-item mode switch from the live offering', async () => {
    mocks.bookingFindUnique.mockResolvedValue(
      sourceRow({
        totalDurationMinutes: 60,
        serviceItems: [{ durationMinutesSnapshot: 60 }],
      }),
    )
    mocks.resolveDurationWithAddOns.mockResolvedValue({
      ok: true,
      durationMinutes: 75,
    })

    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      locationType: ServiceLocationType.MOBILE,
      rebookOf: REBOOK_OF,
    })

    expect(result).toEqual({ ok: true, durationMinutes: 75 })
    expect(mocks.resolveDurationWithAddOns).toHaveBeenCalledWith(
      expect.objectContaining({
        locationType: ServiceLocationType.MOBILE,
        addOnIds: [],
      }),
    )
  })

  it('refuses a request carrying both a reschedule and a rebook context', async () => {
    const result = await resolveAvailabilityDurationMinutes({
      ...BASE_ARGS,
      reschedule: { bookingId: 'bk_move', owner: { kind: 'PRO', professionalId: 'pro_1' } },
      rebookOf: REBOOK_OF,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'INVALID_AVAILABILITY_CONTEXT',
    })
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled()
  })
})
