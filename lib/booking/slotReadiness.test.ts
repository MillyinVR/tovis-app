// lib/booking/slotReadiness.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkAdvanceNotice,
  checkMaxDaysAheadExact,
  checkSlotReadiness,
  computeRequestedEndUtc,
  isStartAlignedToWorkingWindowStep,
} from './slotReadiness'

describe('slotReadiness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('computeRequestedEndUtc', () => {
    it('adds duration plus buffer to the normalized start', () => {
      const endUtc = computeRequestedEndUtc({
        startUtc: new Date('2026-03-11T17:37:42.000Z'),
        durationMinutes: 60,
        bufferMinutes: 15,
      })

      expect(endUtc.toISOString()).toBe('2026-03-11T18:52:00.000Z')
    })
  })

  describe('isStartAlignedToWorkingWindowStep', () => {
    it('uses working-window alignment, not midnight alignment', () => {
      const result = isStartAlignedToWorkingWindowStep({
        startUtc: new Date('2026-03-11T16:10:00.000Z'), // 09:10 America/Los_Angeles
        workingHours: {
          wed: {
            enabled: true,
            start: '09:10',
            end: '17:10',
          },
        },
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.windowStartMinutes).toBe(9 * 60 + 10)
        expect(result.timeZone).toBe('America/Los_Angeles')
      }
    })

    it('rejects a slot that is off the working-window step boundary', () => {
      const result = isStartAlignedToWorkingWindowStep({
        startUtc: new Date('2026-03-11T16:15:00.000Z'), // 09:15 America/Los_Angeles
        workingHours: {
          wed: {
            enabled: true,
            start: '09:10',
            end: '17:10',
          },
        },
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('STEP_MISMATCH')
      }
    })

    it('returns WORKING_HOURS_REQUIRED when working hours are missing', () => {
      const result = isStartAlignedToWorkingWindowStep({
        startUtc: new Date('2026-03-11T16:10:00.000Z'),
        workingHours: null,
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('WORKING_HOURS_REQUIRED')
      }
    })
  })

  describe('checkAdvanceNotice', () => {
    it('passes when the slot is exactly at the advance-notice boundary', () => {
      const result = checkAdvanceNotice({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-11T19:30:00.000Z'),
        advanceNoticeMinutes: 30,
      })

      expect(result).toEqual({ ok: true })
    })

    it('fails when the slot is before the advance-notice boundary', () => {
      const result = checkAdvanceNotice({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-11T19:29:00.000Z'),
        advanceNoticeMinutes: 30,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('ADVANCE_NOTICE_REQUIRED')
      }
    })
  })

  describe('checkMaxDaysAheadExact', () => {
    it('passes exactly at the max-days-ahead timestamp boundary', () => {
      const result = checkMaxDaysAheadExact({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-18T19:00:00.000Z'),
        maxDaysAhead: 7,
      })

      expect(result).toEqual({ ok: true })
    })

    it('fails after the max-days-ahead timestamp boundary even on the same calendar date', () => {
      const result = checkMaxDaysAheadExact({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-18T19:01:00.000Z'),
        maxDaysAhead: 7,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('MAX_DAYS_AHEAD_EXCEEDED')
      }
    })
  })

  describe('checkSlotReadiness', () => {
    it('returns ok with computed end when the slot is fully bookable', () => {
      const result = checkSlotReadiness({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-12T17:10:00.000Z'), // 10:10 America/Los_Angeles on Thu
        durationMinutes: 60,
        bufferMinutes: 15,
        workingHours: {
          thu: {
            enabled: true,
            start: '09:10',
            end: '18:10',
          },
        },
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        advanceNoticeMinutes: 30,
        maxDaysAhead: 14,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.startUtc.toISOString()).toBe('2026-03-12T17:10:00.000Z')
        expect(result.endUtc.toISOString()).toBe('2026-03-12T18:25:00.000Z')
        expect(result.durationMinutes).toBe(60)
        expect(result.bufferMinutes).toBe(15)
        expect(result.stepMinutes).toBe(15)
        expect(result.timeZone).toBe('America/Los_Angeles')
      }
    })

    it('rejects a slot that overflows working hours because of buffer', () => {
      const result = checkSlotReadiness({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-12T23:15:00.000Z'), // 16:15 America/Los_Angeles on Thu
        durationMinutes: 60,
        bufferMinutes: 15,
        workingHours: {
          thu: {
            enabled: true,
            start: '09:00',
            end: '17:00',
          },
        },
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 14,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('OUTSIDE_WORKING_HOURS')
      }
    })

    it('rejects a slot that is too far ahead by exact timestamp', () => {
      const result = checkSlotReadiness({
        nowUtc: new Date('2026-03-11T19:14:00.000Z'),
        startUtc: new Date('2026-03-18T19:15:00.000Z'),
        durationMinutes: 60,
        bufferMinutes: 15,
        workingHours: {
          wed: {
            enabled: true,
            start: '09:00',
            end: '23:00',
          },
        },
        timeZone: 'UTC',
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 7,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('MAX_DAYS_AHEAD_EXCEEDED')
      }
    })

    it('rejects a slot that is off the working-window step even when it is within working hours', () => {
      const result = checkSlotReadiness({
        nowUtc: new Date('2026-03-11T19:00:00.000Z'),
        startUtc: new Date('2026-03-12T17:15:00.000Z'), // 10:15 America/Los_Angeles on Thu
        durationMinutes: 60,
        bufferMinutes: 15,
        workingHours: {
          thu: {
            enabled: true,
            start: '09:10',
            end: '18:10',
          },
        },
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 14,
        fallbackTimeZone: 'UTC',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.code).toBe('STEP_MISMATCH')
      }
    })
  })
})