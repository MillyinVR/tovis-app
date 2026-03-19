// lib/booking/policies/showSlotPolicy.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BusyInterval } from '@/lib/booking/conflicts'
import type { CanShowSlotArgs } from './showSlotPolicy'

const mocks = vi.hoisted(() => ({
  isSlotFree: vi.fn(),
  checkSlotReadiness: vi.fn(),
}))

vi.mock('@/lib/booking/conflicts', () => ({
  isSlotFree: mocks.isSlotFree,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  checkSlotReadiness: mocks.checkSlotReadiness,
}))

import { canShowSlot } from './showSlotPolicy'

const START = new Date('2026-03-11T19:30:00.000Z')
const END = new Date('2026-03-11T20:45:00.000Z')
const NOW = new Date('2026-03-11T19:00:00.000Z')

function makeArgs(): CanShowSlotArgs {
  return {
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
    busy: [],
    fallbackTimeZone: 'UTC',
  }
}

describe('canShowSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.checkSlotReadiness.mockReturnValue({
      ok: true,
      startUtc: START,
      endUtc: END,
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    mocks.isSlotFree.mockReturnValue(true)
  })

  it('returns ok when slot is ready and free', () => {
    const result = canShowSlot(makeArgs())

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

    expect(mocks.isSlotFree).toHaveBeenCalledWith([], START, END)

    expect(result).toEqual({
      ok: true,
      value: {
        startUtc: START,
        endUtc: END,
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        durationMinutes: 60,
        bufferMinutes: 15,
      },
    })
  })

  it('returns SLOT_NOT_READY when slot readiness fails', () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'STEP_MISMATCH',
      meta: {
        reason: 'step-mismatch',
      },
    })

    const result = canShowSlot(makeArgs())

    expect(mocks.isSlotFree).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      code: 'SLOT_NOT_READY',
      slotReadinessCode: 'STEP_MISMATCH',
      meta: {
        reason: 'step-mismatch',
      },
    })
  })

  it('returns SLOT_BUSY when slot is ready but overlaps a busy interval', () => {
    mocks.isSlotFree.mockReturnValueOnce(false)

    const busy: BusyInterval[] = [
      {
        start: new Date('2026-03-11T19:00:00.000Z'),
        end: new Date('2026-03-11T21:00:00.000Z'),
      },
    ]

    const result = canShowSlot({
      ...makeArgs(),
      busy,
    })

    expect(mocks.isSlotFree).toHaveBeenCalledWith(busy, START, END)

    expect(result).toEqual({
      ok: false,
      code: 'SLOT_BUSY',
      endUtc: END,
    })
  })

  it('uses UTC as the default fallback timezone when none is provided', () => {
    const args = makeArgs()
    const { fallbackTimeZone: _ignored, ...withoutFallback } = args

    canShowSlot(withoutFallback)

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
  })

  it('passes through a custom fallback timezone', () => {
    canShowSlot({
      ...makeArgs(),
      fallbackTimeZone: 'America/New_York',
    })

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
      fallbackTimeZone: 'America/New_York',
    })
  })
})