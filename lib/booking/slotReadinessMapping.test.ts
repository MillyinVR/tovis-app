// lib/booking/slotReadinessMapping.test.ts
//
// `mapSlotReadinessToBookingError` is the single translation from a slot-readiness
// refusal to the booking error the caller reports. Two writers depend on it:
// the hold (refuses at CLAIM time) and last-minute opening creation (refuses at
// CREATE time). If they disagreed, a pro could publish an opening at an instant
// no client can hold — which is exactly the bug this mapping was extracted to fix.
//
// So these tests pin the mapping itself, and the companion cases in
// holdPolicy.overlapContract.test.ts pin that the hold still reports what it did
// before the extraction.

import { describe, expect, it } from 'vitest'
import {
  checkSlotReadiness,
  mapSlotReadinessToBookingError,
  type SlotReadinessCode,
} from './slotReadiness'
import { getBookingErrorDescriptor } from './errors'
import type { WorkingHoursObj } from '@/lib/scheduling/workingHoursValidation'

const NINE_TO_FIVE = {
  enabled: true,
  start: '09:00',
  end: '17:00',
} as const

function workingHours(): WorkingHoursObj {
  return {
    sun: NINE_TO_FIVE,
    mon: NINE_TO_FIVE,
    tue: NINE_TO_FIVE,
    wed: NINE_TO_FIVE,
    thu: NINE_TO_FIVE,
    fri: NINE_TO_FIVE,
    sat: NINE_TO_FIVE,
  }
}

describe('mapSlotReadinessToBookingError', () => {
  it('names the step in the step-mismatch copy so the pro knows the boundary', () => {
    expect(
      mapSlotReadinessToBookingError({
        code: 'STEP_MISMATCH',
        stepMinutes: 20,
      }),
    ).toEqual({
      code: 'STEP_MISMATCH',
      message: 'Start time must be on a 20-minute boundary.',
      userMessage: 'Start time must be on a 20-minute boundary.',
    })
  })

  it('decodes the working-hours guard sentinel into human copy', () => {
    expect(
      mapSlotReadinessToBookingError({
        code: 'OUTSIDE_WORKING_HOURS',
        stepMinutes: 15,
        workingHoursError: 'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
      }),
    ).toEqual({
      code: 'OUTSIDE_WORKING_HOURS',
      message: 'That time is outside working hours.',
      userMessage: 'That time is outside working hours.',
    })
  })

  it('passes a working-hours message that is ALREADY human copy through unchanged', () => {
    expect(
      mapSlotReadinessToBookingError({
        code: 'OUTSIDE_WORKING_HOURS',
        stepMinutes: 15,
        workingHoursError: 'Closed on Sundays.',
      }).userMessage,
    ).toBe('Closed on Sundays.')
  })

  it('falls back to generic copy when the working-hours error is missing or blank', () => {
    for (const raw of [undefined, null, '', '   ', 42]) {
      expect(
        mapSlotReadinessToBookingError({
          code: 'OUTSIDE_WORKING_HOURS',
          stepMinutes: 15,
          workingHoursError: raw,
        }).userMessage,
      ).toBe('That time is outside working hours.')
    }
  })

  it('maps every readiness code to a booking error with user-facing copy', () => {
    const codes: SlotReadinessCode[] = [
      'STEP_MISMATCH',
      'ADVANCE_NOTICE_REQUIRED',
      'MAX_DAYS_AHEAD_EXCEEDED',
      'WORKING_HOURS_REQUIRED',
      'WORKING_HOURS_INVALID',
      'OUTSIDE_WORKING_HOURS',
      'INVALID_START',
      'INVALID_DURATION',
      'INVALID_BUFFER',
      'INVALID_RANGE',
    ]

    for (const code of codes) {
      const mapped = mapSlotReadinessToBookingError({ code, stepMinutes: 15 })
      const descriptor = getBookingErrorDescriptor(mapped.code, {
        message: mapped.message,
        userMessage: mapped.userMessage,
      })

      // Every refusal must be sayable to a human — the pro creating the opening
      // sees this string, so an empty or code-shaped message is a bug.
      expect(descriptor.userMessage.trim().length).toBeGreaterThan(0)
      expect(descriptor.userMessage).not.toContain('BOOKING_WORKING_HOURS:')
    }
  })
})

describe('opening creation and hold creation refuse the same instants', () => {
  // One location config, three instants. The hold runs this exact pair of calls
  // inside evaluateHoldCreationDecision; opening creation runs it in
  // createLastMinuteOpening. Same input, same refusal — that IS the contract.
  const config = {
    nowUtc: new Date('2030-05-01T00:00:00.000Z'),
    durationMinutes: 60,
    bufferMinutes: 15,
    workingHours: workingHours(),
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    advanceNoticeMinutes: 0,
    maxDaysAhead: 3650,
    fallbackTimeZone: 'UTC',
  }

  function refusalFor(startUtc: Date): string | null {
    const readiness = checkSlotReadiness({ startUtc, ...config })
    if (readiness.ok) return null
    return mapSlotReadinessToBookingError({
      code: readiness.code,
      stepMinutes: readiness.stepMinutes,
      workingHoursError: readiness.meta?.workingHoursError,
    }).code
  }

  it('accepts an on-step instant inside working hours', () => {
    // 10:00 PT — on the 15-minute grid, and 10:00-11:15 fits inside 09:00-17:00.
    expect(refusalFor(new Date('2030-05-01T17:00:00.000Z'))).toBeNull()
  })

  it('refuses an off-step instant inside working hours', () => {
    // 10:07 PT — the shape a pro produces by typing a time freehand.
    expect(refusalFor(new Date('2030-05-01T17:07:00.000Z'))).toBe(
      'STEP_MISMATCH',
    )
  })

  it('refuses an on-step instant outside working hours', () => {
    // 20:00 PT — on the grid, but the salon closed at 17:00. This is the exact
    // shape that shipped an unclaimable opening into the client feed.
    expect(refusalFor(new Date('2030-05-02T03:00:00.000Z'))).toBe(
      'OUTSIDE_WORKING_HOURS',
    )
  })
})
