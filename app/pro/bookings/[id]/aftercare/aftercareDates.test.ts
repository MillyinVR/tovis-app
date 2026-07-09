import { describe, expect, it } from 'vitest'

import {
  SUGGESTED_REBOOK_WINDOW_SPAN_DAYS,
  addDaysToYmd,
  addMonthsToYmd,
  compareYmd,
  computeSuggestedRebookWindow,
  isoToYmdInTimeZone,
  stepDatetimeLocal,
  stepYmd,
  ymdToIsoEndOfDay,
  ymdToIsoStartOfDay,
} from './aftercareDates'

const LA = 'America/Los_Angeles'

describe('aftercareDates', () => {
  it('adds days, crossing month/year boundaries', () => {
    expect(addDaysToYmd('2026-06-13', 1)).toBe('2026-06-14')
    expect(addDaysToYmd('2026-06-13', 7)).toBe('2026-06-20')
    expect(addDaysToYmd('2026-06-30', 1)).toBe('2026-07-01')
    expect(addDaysToYmd('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('adds months and clamps the day to the target month length', () => {
    expect(addMonthsToYmd('2026-06-13', 1)).toBe('2026-07-13')
    expect(addMonthsToYmd('2026-01-31', 1)).toBe('2026-02-28') // 2026 not leap
    expect(addMonthsToYmd('2024-01-31', 1)).toBe('2024-02-29') // leap year
    expect(addMonthsToYmd('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('rejects malformed or overflow dates', () => {
    expect(addDaysToYmd('not-a-date', 1)).toBeNull()
    expect(addDaysToYmd('2026-02-31', 1)).toBeNull()
    expect(addMonthsToYmd('2026-13-01', 1)).toBeNull()
  })

  it('compares calendar dates lexically', () => {
    expect(compareYmd('2026-06-13', '2026-06-14')).toBe(-1)
    expect(compareYmd('2026-06-14', '2026-06-13')).toBe(1)
    expect(compareYmd('2026-06-13', '2026-06-13')).toBe(0)
  })

  it('steps a date-only value by unit, falling back when empty', () => {
    expect(stepYmd('2026-06-13', 'day', '2026-01-01')).toBe('2026-06-14')
    expect(stepYmd('2026-06-13', 'week', '2026-01-01')).toBe('2026-06-20')
    expect(stepYmd('2026-06-13', 'month', '2026-01-01')).toBe('2026-07-13')
    expect(stepYmd('', 'day', '2026-06-13')).toBe('2026-06-14')
  })

  it('steps the date part of a datetime-local value, preserving time', () => {
    expect(stepDatetimeLocal('2026-06-13T14:30', 'day', '2026-01-01')).toBe(
      '2026-06-14T14:30',
    )
    expect(stepDatetimeLocal('2026-06-13T14:30', 'week', '2026-01-01')).toBe(
      '2026-06-20T14:30',
    )
    expect(stepDatetimeLocal('2026-06-13T14:30', 'month', '2026-01-01')).toBe(
      '2026-07-13T14:30',
    )
    // empty -> fallback date at noon
    expect(stepDatetimeLocal('', 'day', '2026-06-13')).toBe('2026-06-14T12:00')
  })

  it('converts a calendar date to tz-aware start/end-of-day instants', () => {
    // June is PDT (UTC-7).
    expect(ymdToIsoStartOfDay('2026-06-13', LA)).toBe('2026-06-13T07:00:00.000Z')
    expect(ymdToIsoEndOfDay('2026-06-13', LA)).toBe('2026-06-14T06:59:00.000Z')
    expect(ymdToIsoStartOfDay('bad', LA)).toBeNull()
  })

  it('round-trips an instant back to the tz calendar date', () => {
    expect(isoToYmdInTimeZone('2026-06-13T07:00:00.000Z', LA)).toBe('2026-06-13')
    // 06:59Z is still June 13 in LA (23:59 PDT)
    expect(isoToYmdInTimeZone('2026-06-14T06:59:00.000Z', LA)).toBe('2026-06-13')
    expect(isoToYmdInTimeZone(null, LA)).toBe('')
  })
})

describe('computeSuggestedRebookWindow', () => {
  // Anchor 2026-03-01T17:00Z = 2026-03-01 09:00 PST, so the service-date YMD in
  // LA is 2026-03-01. Assertions check the round-trip through isoToYmdInTimeZone
  // (the same conversion the form uses to render the window), so they stay
  // correct across the PST→PDT transition that falls inside the window.
  const ANCHOR_ISO = '2026-03-01T17:00:00.000Z'

  it('anchors the window at service date + interval', () => {
    const result = computeSuggestedRebookWindow({
      intervalDays: 42,
      anchorIso: ANCHOR_ISO,
      timeZone: LA,
    })

    expect(result).not.toBeNull()
    // 2026-03-01 + 42d = 2026-04-12; end = start + 7d = 2026-04-19.
    expect(isoToYmdInTimeZone(result!.windowStartIso, LA)).toBe('2026-04-12')
    expect(isoToYmdInTimeZone(result!.windowEndIso, LA)).toBe('2026-04-19')
  })

  it('spans exactly SUGGESTED_REBOOK_WINDOW_SPAN_DAYS', () => {
    const result = computeSuggestedRebookWindow({
      intervalDays: 30,
      anchorIso: ANCHOR_ISO,
      timeZone: LA,
    })

    const startYmd = isoToYmdInTimeZone(result!.windowStartIso, LA)
    const endYmd = isoToYmdInTimeZone(result!.windowEndIso, LA)
    expect(addDaysToYmd(startYmd, SUGGESTED_REBOOK_WINDOW_SPAN_DAYS)).toBe(endYmd)
  })

  it('uses start-of-day / end-of-day (end instant strictly after start)', () => {
    const result = computeSuggestedRebookWindow({
      intervalDays: 7,
      anchorIso: ANCHOR_ISO,
      timeZone: LA,
    })

    expect(new Date(result!.windowEndIso).getTime()).toBeGreaterThan(
      new Date(result!.windowStartIso).getTime(),
    )
  })

  it('truncates a fractional interval to whole days', () => {
    const result = computeSuggestedRebookWindow({
      intervalDays: 42.9,
      anchorIso: ANCHOR_ISO,
      timeZone: LA,
    })

    // 42.9 → 42 days → 2026-04-12, not 2026-04-13.
    expect(isoToYmdInTimeZone(result!.windowStartIso, LA)).toBe('2026-04-12')
  })

  it('returns null when no positive interval is set', () => {
    for (const intervalDays of [null, undefined, 0, -5, Number.NaN]) {
      expect(
        computeSuggestedRebookWindow({
          intervalDays,
          anchorIso: ANCHOR_ISO,
          timeZone: LA,
        }),
      ).toBeNull()
    }
  })

  it('returns null when the anchor date is missing or invalid', () => {
    for (const anchorIso of [null, undefined, '', 'not-a-date']) {
      expect(
        computeSuggestedRebookWindow({
          intervalDays: 42,
          anchorIso,
          timeZone: LA,
        }),
      ).toBeNull()
    }
  })

  it('falls back to UTC for a blank timezone without throwing', () => {
    const result = computeSuggestedRebookWindow({
      intervalDays: 14,
      anchorIso: '2026-06-10T12:00:00.000Z',
      timeZone: '',
    })

    expect(result).not.toBeNull()
    // 2026-06-10 (UTC) + 14d = 2026-06-24.
    expect(isoToYmdInTimeZone(result!.windowStartIso, 'UTC')).toBe('2026-06-24')
  })
})
