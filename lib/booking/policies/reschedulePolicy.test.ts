// lib/booking/policies/reschedulePolicy.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  addMinutes: vi.fn(),
  assertTimeRangeAvailable: vi.fn(),
  checkSlotReadiness: vi.fn(),
}))

vi.mock('@/lib/booking/conflicts', () => ({
  addMinutes: mocks.addMinutes,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  assertTimeRangeAvailable: mocks.assertTimeRangeAvailable,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  checkSlotReadiness: mocks.checkSlotReadiness,
}))

import { evaluateRescheduleDecision } from './reschedulePolicy'

const tx = {} as Prisma.TransactionClient
const NOW = new Date('2026-03-11T19:00:00.000Z')
const START = new Date('2026-03-11T19:30:00.000Z')
const END = new Date('2026-03-11T20:45:00.000Z')

function makeArgs() {
  return {
    tx,
    now: NOW,
    professionalId: 'pro_123',
    bookingId: 'booking_1',
    holdId: 'hold_1',
    requestedStart: START,
    durationMinutes: 60,
    bufferMinutes: 15,
    locationId: 'loc_1',
    workingHours: {
      wed: { enabled: true, start: '09:00', end: '18:00' },
    },
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    advanceNoticeMinutes: 0,
    maxDaysAhead: 30,
    fallbackTimeZone: 'UTC',
  } as const
}

describe('evaluateRescheduleDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.addMinutes.mockImplementation((start: Date, minutes: number) => {
      return new Date(start.getTime() + minutes * 60_000)
    })

    mocks.checkSlotReadiness.mockReturnValue({
      ok: true,
      startUtc: START,
      endUtc: END,
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    mocks.assertTimeRangeAvailable.mockResolvedValue(undefined)
  })

  it('returns ok when slot is ready and time range is available', async () => {
    const result = await evaluateRescheduleDecision(makeArgs())

    expect(mocks.checkSlotReadiness).toHaveBeenCalledWith({
      startUtc: START,
      nowUtc: NOW,
      durationMinutes: 60,
      bufferMinutes: 15,
      workingHours: {
        wed: { enabled: true, start: '09:00', end: '18:00' },
      },
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 30,
      fallbackTimeZone: 'UTC',
    })

    expect(mocks.assertTimeRangeAvailable).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: START,
      requestedEnd: END,
      defaultBufferMinutes: 15,
      fallbackDurationMinutes: 60,
      excludeBookingId: 'booking_1',
      excludeHoldId: 'hold_1',
    })

    expect(result).toEqual({
      ok: true,
      value: {
        requestedEnd: END,
      },
    })
  })

  it('returns TIME_IN_PAST when requested start is in the past', async () => {
    const result = await evaluateRescheduleDecision({
      ...makeArgs(),
      requestedStart: new Date('2026-03-11T18:59:00.000Z'),
    })

    expect(mocks.checkSlotReadiness).not.toHaveBeenCalled()
    expect(mocks.assertTimeRangeAvailable).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'TIME_IN_PAST',
      message: undefined,
      userMessage: undefined,
    })
  })

  it('returns HOLD_TIME_INVALID when requested start is invalid', async () => {
    const invalidDate = new Date('invalid')

    const result = await evaluateRescheduleDecision({
      ...makeArgs(),
      requestedStart: invalidDate,
    })

    expect(mocks.checkSlotReadiness).not.toHaveBeenCalled()
    expect(mocks.assertTimeRangeAvailable).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'HOLD_TIME_INVALID',
      message: undefined,
      userMessage: undefined,
    })
  })

  it('returns STEP_MISMATCH when held time is off step', async () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'STEP_MISMATCH',
      meta: {},
    })

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(mocks.assertTimeRangeAvailable).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'STEP_MISMATCH',
      message: 'Start time must be on a 15-minute boundary.',
      userMessage: 'Start time must be on a 15-minute boundary.',
    })
  })

  it('returns OUTSIDE_WORKING_HOURS when outside working hours', async () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      meta: {
        workingHoursError: 'That time is outside working hours.',
      },
    })

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(mocks.assertTimeRangeAvailable).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      message: 'That time is outside working hours.',
      userMessage: 'That time is outside working hours.',
    })
  })

  it('returns ADVANCE_NOTICE_REQUIRED when advance notice fails', async () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      meta: {},
    })

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
      message: undefined,
      userMessage: undefined,
    })
  })

  it('returns MAX_DAYS_AHEAD_EXCEEDED when max days ahead fails', async () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      meta: {},
    })

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
      message: undefined,
      userMessage: undefined,
    })
  })

  it('returns TIME_BLOCKED when assertTimeRangeAvailable rejects TIME_BLOCKED', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('TIME_BLOCKED'))

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'TIME_BLOCKED',
      message: undefined,
      userMessage: undefined,
    })
  })

  it('returns TIME_BOOKED when assertTimeRangeAvailable rejects TIME_BOOKED', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('TIME_BOOKED'))

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'TIME_BOOKED',
      message: undefined,
      userMessage: undefined,
    })
  })

  it('returns TIME_HELD when assertTimeRangeAvailable rejects TIME_HELD', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('TIME_HELD'))

    const result = await evaluateRescheduleDecision(makeArgs())

    expect(result).toEqual({
      ok: false,
      code: 'TIME_HELD',
      message: undefined,
      userMessage: undefined,
    })
  })
})