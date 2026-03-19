// lib/booking/policies/proSchedulingPolicy.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  addMinutes: vi.fn(),
  getTimeRangeConflict: vi.fn(),
  ensureWithinWorkingHours: vi.fn(),
  checkAdvanceNotice: vi.fn(),
  checkMaxDaysAheadExact: vi.fn(),
  computeRequestedEndUtc: vi.fn(),
  isStartAlignedToWorkingWindowStep: vi.fn(),
}))

vi.mock('@/lib/booking/conflicts', () => ({
  addMinutes: mocks.addMinutes,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/workingHoursGuard', () => ({
  ensureWithinWorkingHours: mocks.ensureWithinWorkingHours,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  checkAdvanceNotice: mocks.checkAdvanceNotice,
  checkMaxDaysAheadExact: mocks.checkMaxDaysAheadExact,
  computeRequestedEndUtc: mocks.computeRequestedEndUtc,
  isStartAlignedToWorkingWindowStep: mocks.isStartAlignedToWorkingWindowStep,
}))

import { evaluateProSchedulingDecision } from './proSchedulingPolicy'

const now = new Date('2026-03-11T19:00:00.000Z')
const requestedStart = new Date('2026-03-11T19:30:00.000Z')
const requestedEnd = new Date('2026-03-11T20:45:00.000Z')
const workingHours = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false, start: '09:00', end: '17:00' },
  sun: { enabled: false, start: '09:00', end: '17:00' },
}

function makeArgs() {
  return {
    now,
    professionalId: 'pro_123',
    locationId: 'loc_1',
    locationType: ServiceLocationType.SALON,
    requestedStart,
    durationMinutes: 60,
    bufferMinutes: 15,
    workingHours,
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    advanceNoticeMinutes: 30,
    maxDaysAhead: 30,
    allowShortNotice: false,
    allowFarFuture: false,
    allowOutsideWorkingHours: false,
  } as const
}

describe('evaluateProSchedulingDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.addMinutes.mockImplementation((start: Date, minutes: number) => {
      return new Date(start.getTime() + minutes * 60_000)
    })

    mocks.computeRequestedEndUtc.mockReturnValue(requestedEnd)

    mocks.isStartAlignedToWorkingWindowStep.mockReturnValue({
      ok: true,
    })

    mocks.checkAdvanceNotice.mockReturnValue({
      ok: true,
    })

    mocks.checkMaxDaysAheadExact.mockReturnValue({
      ok: true,
    })

    mocks.ensureWithinWorkingHours.mockReturnValue({
      ok: true,
    })

    mocks.getTimeRangeConflict.mockResolvedValue(null)
  })

  it('returns ok with requestedEnd when all checks pass', async () => {
    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.computeRequestedEndUtc).toHaveBeenCalledWith({
      startUtc: requestedStart,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    expect(mocks.isStartAlignedToWorkingWindowStep).toHaveBeenCalledWith({
      startUtc: requestedStart,
      workingHours,
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      fallbackTimeZone: 'UTC',
    })

    expect(mocks.checkAdvanceNotice).toHaveBeenCalledWith({
      startUtc: requestedStart,
      nowUtc: now,
      advanceNoticeMinutes: 30,
    })

    expect(mocks.checkMaxDaysAheadExact).toHaveBeenCalledWith({
      startUtc: requestedStart,
      nowUtc: now,
      maxDaysAhead: 30,
    })

    expect(mocks.ensureWithinWorkingHours).toHaveBeenCalledWith({
      scheduledStartUtc: requestedStart,
      scheduledEndUtc: requestedEnd,
      workingHours,
      timeZone: 'America/Los_Angeles',
      fallbackTimeZone: 'UTC',
      messages: {
        missing: 'BOOKING_WORKING_HOURS:WORKING_HOURS_REQUIRED',
        outside: 'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
        misconfigured: 'BOOKING_WORKING_HOURS:WORKING_HOURS_INVALID',
      },
    })

    expect(mocks.getTimeRangeConflict).toHaveBeenCalledWith({
      tx: undefined,
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart,
      requestedEnd,
      defaultBufferMinutes: 15,
      fallbackDurationMinutes: 60,
      excludeBookingId: null,
      excludeHoldId: null,
      nowUtc: now,
    })

    expect(result).toEqual({
      ok: true,
      value: {
        requestedEnd,
      },
    })
  })

  it('returns STEP_MISMATCH when start is off step', async () => {
    mocks.isStartAlignedToWorkingWindowStep.mockReturnValueOnce({
      ok: false,
      code: 'STEP_MISMATCH',
      meta: {
        nearestBoundary: '2026-03-11T19:15:00.000Z',
      },
    })

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.addMinutes).toHaveBeenCalledWith(requestedStart, 1)
    expect(mocks.checkAdvanceNotice).not.toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'STEP_MISMATCH',
      logHint: {
        requestedStart,
        requestedEnd: new Date('2026-03-11T19:31:00.000Z'),
        conflictType: 'STEP_BOUNDARY',
        meta: {
          stepMinutes: 15,
          nearestBoundary: '2026-03-11T19:15:00.000Z',
        },
      },
    })
  })

  it('returns WORKING_HOURS_REQUIRED when step alignment cannot be evaluated because working hours are missing', async () => {
    mocks.isStartAlignedToWorkingWindowStep.mockReturnValueOnce({
      ok: false,
      code: 'WORKING_HOURS_REQUIRED',
    })

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.checkAdvanceNotice).not.toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'WORKING_HOURS_REQUIRED',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: 'BOOKING_WORKING_HOURS:WORKING_HOURS_REQUIRED',
        },
      },
    })
  })

  it('returns WORKING_HOURS_INVALID when step alignment detects invalid working hours config', async () => {
    mocks.isStartAlignedToWorkingWindowStep.mockReturnValueOnce({
      ok: false,
      code: 'WORKING_HOURS_INVALID',
    })

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.checkAdvanceNotice).not.toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'WORKING_HOURS_INVALID',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: 'BOOKING_WORKING_HOURS:WORKING_HOURS_INVALID',
        },
      },
    })
  })

  it('does not fail on step check OUTSIDE_WORKING_HOURS and defers to full range working-hours guard', async () => {
    mocks.isStartAlignedToWorkingWindowStep.mockReturnValueOnce({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
    })

    mocks.ensureWithinWorkingHours.mockReturnValueOnce({
      ok: false,
      error: 'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
    })

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.checkAdvanceNotice).toHaveBeenCalled()
    expect(mocks.checkMaxDaysAheadExact).toHaveBeenCalled()
    expect(mocks.ensureWithinWorkingHours).toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'WORKING_HOURS',
        meta: {
          workingHoursError: 'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
        },
      },
    })
  })

  it('returns ADVANCE_NOTICE_REQUIRED when advance notice fails and short notice is not allowed', async () => {
    mocks.checkAdvanceNotice.mockReturnValueOnce({
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      meta: {
        earliestAllowedStart: '2026-03-11T20:00:00.000Z',
      },
    })

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.checkMaxDaysAheadExact).not.toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'TIME_NOT_AVAILABLE',
        meta: {
          rule: 'ADVANCE_NOTICE',
          advanceNoticeMinutes: 30,
          earliestAllowedStart: '2026-03-11T20:00:00.000Z',
        },
      },
    })
  })

  it('skips advance notice when allowShortNotice is true', async () => {
    const result = await evaluateProSchedulingDecision({
      ...makeArgs(),
      allowShortNotice: true,
    })

    expect(mocks.checkAdvanceNotice).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      value: {
        requestedEnd,
      },
    })
  })

  it('returns MAX_DAYS_AHEAD_EXCEEDED when max days ahead fails and far future is not allowed', async () => {
    mocks.checkMaxDaysAheadExact.mockReturnValueOnce({
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      meta: {
        latestAllowedStart: '2026-04-10T19:00:00.000Z',
      },
    })

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(mocks.ensureWithinWorkingHours).not.toHaveBeenCalled()
    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'TIME_NOT_AVAILABLE',
        meta: {
          rule: 'MAX_DAYS_AHEAD',
          maxDaysAhead: 30,
          latestAllowedStart: '2026-04-10T19:00:00.000Z',
        },
      },
    })
  })

  it('skips max days ahead when allowFarFuture is true', async () => {
    const result = await evaluateProSchedulingDecision({
      ...makeArgs(),
      allowFarFuture: true,
    })

    expect(mocks.checkMaxDaysAheadExact).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      value: {
        requestedEnd,
      },
    })
  })

  it('skips full working-hours guard when allowOutsideWorkingHours is true', async () => {
    const result = await evaluateProSchedulingDecision({
      ...makeArgs(),
      allowOutsideWorkingHours: true,
    })

    expect(mocks.ensureWithinWorkingHours).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      value: {
        requestedEnd,
      },
    })
  })

  it('returns TIME_BLOCKED when calendar block conflicts', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'TIME_BLOCKED',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'BLOCKED',
      },
    })
  })

  it('returns TIME_BOOKED when an existing booking conflicts', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BOOKING')

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'TIME_BOOKED',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'BOOKING',
      },
    })
  })

  it('returns TIME_HELD when an active hold conflicts', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await evaluateProSchedulingDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'TIME_HELD',
      logHint: {
        requestedStart,
        requestedEnd,
        conflictType: 'HOLD',
      },
    })
  })

  it('passes exclude ids through to conflict lookup when provided', async () => {
    await evaluateProSchedulingDecision({
      ...makeArgs(),
      excludeBookingId: 'booking_123',
      excludeHoldId: 'hold_456',
    })

    expect(mocks.getTimeRangeConflict).toHaveBeenCalledWith({
      tx: undefined,
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart,
      requestedEnd,
      defaultBufferMinutes: 15,
      fallbackDurationMinutes: 60,
      excludeBookingId: 'booking_123',
      excludeHoldId: 'hold_456',
      nowUtc: now,
    })
  })
})