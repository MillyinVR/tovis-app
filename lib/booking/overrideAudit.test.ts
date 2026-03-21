// lib/booking/overrideAudit.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingOverrideAction,
  BookingOverrideRule,
} from '@prisma/client'

import { buildBookingOverrideAuditRows } from './overrideAudit'

const FIXED_NOW = new Date('2026-03-22T15:00:00.000Z')
const BEFORE_TIME = new Date('2026-03-25T17:00:00.000Z')
const AFTER_TIME = new Date('2026-03-25T18:30:00.000Z')

function makeArgs(
  overrides: Partial<Parameters<typeof buildBookingOverrideAuditRows>[0]> = {},
): Parameters<typeof buildBookingOverrideAuditRows>[0] {
  return {
    bookingId: 'booking_123',
    professionalId: 'pro_123',
    actorUserId: 'user_123',
    action: 'CREATE',
    route: 'lib/booking/writeBoundary.ts:createProBooking',
    reason: '  approved by manager  ',
    appliedOverrides: ['ADVANCE_NOTICE'],
    bookingScheduledForBefore: BEFORE_TIME,
    bookingScheduledForAfter: AFTER_TIME,
    advanceNoticeMinutes: 30,
    maxDaysAhead: 45,
    workingHours: {
      mon: { enabled: true, start: '09:00', end: '17:00' },
      tue: { enabled: false, start: '09:00', end: '17:00' },
    },
    timeZone: 'America/Los_Angeles',
    ...overrides,
  }
}

describe('buildBookingOverrideAuditRows', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds an ADVANCE_NOTICE audit row for CREATE', () => {
    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        action: 'CREATE',
        appliedOverrides: ['ADVANCE_NOTICE'],
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      bookingId: 'booking_123',
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      action: BookingOverrideAction.CREATE,
      rule: BookingOverrideRule.ADVANCE_NOTICE,
      reason: 'approved by manager',
      route: 'lib/booking/writeBoundary.ts:createProBooking',
      requestId: null,
      oldValue: {
        allowShortNotice: false,
        advanceNoticeMinutes: 30,
      },
      newValue: {
        allowShortNotice: true,
        advanceNoticeMinutes: 30,
      },
      bookingScheduledForBefore: BEFORE_TIME,
      bookingScheduledForAfter: AFTER_TIME,
      metadata: {
        source: 'booking_override_audit',
        appliedOverride: 'ADVANCE_NOTICE',
        timeZone: 'America/Los_Angeles',
      },
      createdAt: FIXED_NOW,
    })
  })

  it('builds a MAX_DAYS_AHEAD audit row for UPDATE', () => {
    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        action: 'UPDATE',
        appliedOverrides: ['MAX_DAYS_AHEAD'],
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      bookingId: 'booking_123',
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      action: BookingOverrideAction.UPDATE,
      rule: BookingOverrideRule.MAX_DAYS_AHEAD,
      reason: 'approved by manager',
      route: 'lib/booking/writeBoundary.ts:createProBooking',
      requestId: null,
      oldValue: {
        allowFarFuture: false,
        maxDaysAhead: 45,
      },
      newValue: {
        allowFarFuture: true,
        maxDaysAhead: 45,
      },
      bookingScheduledForBefore: BEFORE_TIME,
      bookingScheduledForAfter: AFTER_TIME,
      metadata: {
        source: 'booking_override_audit',
        appliedOverride: 'MAX_DAYS_AHEAD',
        timeZone: 'America/Los_Angeles',
      },
      createdAt: FIXED_NOW,
    })
  })

  it('builds a WORKING_HOURS audit row with working hours payload', () => {
    const workingHours = {
      mon: { enabled: true, start: '10:00', end: '18:00' },
      sat: { enabled: false, start: '09:00', end: '17:00' },
    }

    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        appliedOverrides: ['WORKING_HOURS'],
        workingHours,
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      bookingId: 'booking_123',
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      action: BookingOverrideAction.CREATE,
      rule: BookingOverrideRule.WORKING_HOURS,
      reason: 'approved by manager',
      route: 'lib/booking/writeBoundary.ts:createProBooking',
      requestId: null,
      oldValue: {
        allowOutsideWorkingHours: false,
        workingHours,
        timeZone: 'America/Los_Angeles',
      },
      newValue: {
        allowOutsideWorkingHours: true,
        workingHours,
        timeZone: 'America/Los_Angeles',
      },
      bookingScheduledForBefore: BEFORE_TIME,
      bookingScheduledForAfter: AFTER_TIME,
      metadata: {
        source: 'booking_override_audit',
        appliedOverride: 'WORKING_HOURS',
        timeZone: 'America/Los_Angeles',
      },
      createdAt: FIXED_NOW,
    })
  })

  it('returns one row per unique applied override', () => {
    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        appliedOverrides: [
          'ADVANCE_NOTICE',
          'MAX_DAYS_AHEAD',
          'ADVANCE_NOTICE',
          'WORKING_HOURS',
        ],
      }),
    )

    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.rule)).toEqual([
      BookingOverrideRule.ADVANCE_NOTICE,
      BookingOverrideRule.MAX_DAYS_AHEAD,
      BookingOverrideRule.WORKING_HOURS,
    ])
  })

  it('preserves null before timestamp for create-style events', () => {
    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        bookingScheduledForBefore: null,
        appliedOverrides: ['ADVANCE_NOTICE'],
      }),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.bookingScheduledForBefore).toBeNull()
    expect(rows[0]?.bookingScheduledForAfter).toEqual(AFTER_TIME)
  })

  it('returns no rows when reason is blank after trimming', () => {
    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        reason: '   ',
        appliedOverrides: ['ADVANCE_NOTICE'],
      }),
    )

    expect(rows).toEqual([])
  })

  it('returns no rows when there are no applied overrides', () => {
    const rows = buildBookingOverrideAuditRows(
      makeArgs({
        appliedOverrides: [],
      }),
    )

    expect(rows).toEqual([])
  })
})