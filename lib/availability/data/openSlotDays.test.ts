import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getScheduleVersion: vi.fn(),
  getScheduleConfigVersion: vi.fn(),
  loadAvailabilityOfferingContext: vi.fn(),
  resolveAvailabilityDurationMinutes: vi.fn(),
  loadBusyIntervals: vi.fn(),
  computeDaySlotsFast: vi.fn(),
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  getScheduleVersion: mocks.getScheduleVersion,
  getScheduleConfigVersion: mocks.getScheduleConfigVersion,
}))

vi.mock('@/lib/availability/data/offeringContext', () => ({
  loadAvailabilityOfferingContext: mocks.loadAvailabilityOfferingContext,
}))

vi.mock('@/lib/availability/data/durationContext', () => ({
  resolveAvailabilityDurationMinutes: mocks.resolveAvailabilityDurationMinutes,
}))

vi.mock('@/lib/availability/data/busyIntervals', () => ({
  loadBusyIntervals: mocks.loadBusyIntervals,
}))

vi.mock('@/lib/availability/core/dayComputation', async (orig) => ({
  ...(await orig<typeof import('@/lib/availability/core/dayComputation')>()),
  computeDaySlotsFast: mocks.computeDaySlotsFast,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {}, prismaRead: {} }))

import { loadOpenSlotDays } from './openSlotDays'

const BASE_ARGS = {
  professionalId: 'pro_1',
  serviceId: 'svc_1',
  requestedLocationType: null,
  requestedLocationId: null,
  addOnIds: [] as string[],
  rescheduleBookingId: null,
  fromYmd: '2026-09-01',
  toYmd: '2026-09-03',
}

describe('loadOpenSlotDays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getScheduleVersion.mockResolvedValue(7)
    mocks.getScheduleConfigVersion.mockResolvedValue(3)
    mocks.loadAvailabilityOfferingContext.mockResolvedValue({
      ok: true,
      value: {
        locationId: 'loc_1',
        effectiveLocationType: 'SALON',
        timeZone: 'America/Los_Angeles',
        workingHours: {},
        defaultStepMinutes: 15,
        defaultLead: 0,
        locationBufferMinutes: 10,
        maxAdvanceDays: 365,
        durationMinutes: 60,
        offeringDbId: 'off_1',
      },
    })
    mocks.resolveAvailabilityDurationMinutes.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
    })
    mocks.loadBusyIntervals.mockResolvedValue([])
    mocks.computeDaySlotsFast.mockResolvedValue({
      ok: true,
      slots: ['a', 'b'],
      dayStartUtc: new Date(),
      dayEndExclusiveUtc: new Date(),
    })
  })

  it('counts every day in the inclusive range', async () => {
    const result = await loadOpenSlotDays(BASE_ARGS)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.openSlots).toEqual({
      '2026-09-01': 2,
      '2026-09-02': 2,
      '2026-09-03': 2,
    })
    expect(result.durationMinutes).toBe(60)
    expect(result.timeZone).toBe('America/Los_Angeles')
  })

  // The cost claim R4 rests on: ONE occupancy query for the whole range, then a
  // pure in-memory pass per day — not one slot-engine query per day.
  it('loads occupancy exactly once for the whole range', async () => {
    await loadOpenSlotDays({ ...BASE_ARGS, toYmd: '2026-09-30' })

    expect(mocks.loadBusyIntervals).toHaveBeenCalledTimes(1)
    expect(mocks.computeDaySlotsFast).toHaveBeenCalledTimes(30)
  })

  // A day the engine refuses (no working hours, past, beyond the horizon) has
  // zero bookable starts. That is a COUNT, not an error: the grid should show
  // the day as full, and the other days must still be counted.
  it('counts a refused day as zero rather than failing the range', async () => {
    mocks.computeDaySlotsFast
      .mockResolvedValueOnce({ ok: false, code: 'WORKING_HOURS_REQUIRED' })
      .mockResolvedValue({
        ok: true,
        slots: ['a'],
        dayStartUtc: new Date(),
        dayEndExclusiveUtc: new Date(),
      })

    const result = await loadOpenSlotDays(BASE_ARGS)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.openSlots['2026-09-01']).toBe(0)
    expect(result.openSlots['2026-09-02']).toBe(1)
  })

  // [[offer-reserve-commit-are-three-windows]]: a reschedule commits the
  // BOOKING's width, so the count must be sized from it — and the booking must
  // stop blocking its own day (B3-B), or the day it currently sits on looks
  // fuller than it is.
  it('sizes a reschedule from the booking and excludes it from its own occupancy', async () => {
    await loadOpenSlotDays({ ...BASE_ARGS, rescheduleBookingId: 'bk_9' })

    expect(mocks.resolveAvailabilityDurationMinutes).toHaveBeenCalledWith(
      expect.objectContaining({
        reschedule: {
          bookingId: 'bk_9',
          owner: { kind: 'PRO', professionalId: 'pro_1' },
        },
      }),
    )
    expect(mocks.loadBusyIntervals).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBookingId: 'bk_9' }),
    )
  })

  it('sends no reschedule context for a plain new booking', async () => {
    await loadOpenSlotDays(BASE_ARGS)

    expect(mocks.resolveAvailabilityDurationMinutes).toHaveBeenCalledWith(
      expect.objectContaining({ reschedule: null, addOnIds: [] }),
    )
    expect(mocks.loadBusyIntervals).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBookingId: null }),
    )
  })

  it('surfaces a missing service rather than counting zeroes', async () => {
    mocks.loadAvailabilityOfferingContext.mockResolvedValue({
      ok: false,
      kind: 'NOT_FOUND',
      entity: 'SERVICE',
    })

    const result = await loadOpenSlotDays(BASE_ARGS)

    expect(result).toEqual({ ok: false, code: 'SERVICE_NOT_FOUND' })
    expect(mocks.loadBusyIntervals).not.toHaveBeenCalled()
  })

  it('surfaces a width refusal (unmovable booking) without querying occupancy', async () => {
    mocks.resolveAvailabilityDurationMinutes.mockResolvedValue({
      ok: false,
      code: 'BOOKING_ALREADY_STARTED',
    })

    const result = await loadOpenSlotDays({
      ...BASE_ARGS,
      rescheduleBookingId: 'bk_9',
    })

    expect(result).toEqual({ ok: false, code: 'BOOKING_ALREADY_STARTED' })
    expect(mocks.loadBusyIntervals).not.toHaveBeenCalled()
  })

  it('refuses an inverted range instead of returning an empty count', async () => {
    const result = await loadOpenSlotDays({
      ...BASE_ARGS,
      fromYmd: '2026-09-10',
      toYmd: '2026-09-01',
    })

    expect(result).toEqual({ ok: false, code: 'INVALID_RANGE' })
  })
})
