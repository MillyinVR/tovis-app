import { describe, expect, it } from 'vitest'

import {
  enumerateYmdRange,
  parseSummaryWindowDays,
  parseYYYYMMDD,
  ymdSerial,
  ymdToString,
} from './summaryWindow'

// An OMITTED `days` used to mean one day, not the default seven: `Number(null)`
// is 0, which is finite, so an absent param took the "asked for zero" path and
// clamped to 1. Web always sends the param, so the bug only ever showed up on
// the native client — as a booking sheet whose day scroller was empty whenever
// today was booked out.
describe('parseSummaryWindowDays', () => {
  const HORIZON = 3650

  it('falls back to the default window when the param is absent', () => {
    expect(parseSummaryWindowDays(null, HORIZON)).toBe(7)
    expect(parseSummaryWindowDays('', HORIZON)).toBe(7)
    expect(parseSummaryWindowDays('   ', HORIZON)).toBe(7)
    expect(parseSummaryWindowDays('not-a-number', HORIZON)).toBe(7)
  })

  it('honours an explicit request, clamped to the supported range', () => {
    expect(parseSummaryWindowDays('14', HORIZON)).toBe(14)
    expect(parseSummaryWindowDays('1', HORIZON)).toBe(1)
    // An explicit zero/negative is still a caller asking for nothing — floor it
    // at one day rather than silently widening it to the default.
    expect(parseSummaryWindowDays('0', HORIZON)).toBe(1)
    expect(parseSummaryWindowDays('-3', HORIZON)).toBe(1)
    expect(parseSummaryWindowDays('999', HORIZON)).toBe(21)
  })

  it('never offers more days than the booking horizon allows', () => {
    expect(parseSummaryWindowDays(null, 3)).toBe(3)
    expect(parseSummaryWindowDays('14', 3)).toBe(3)
    expect(parseSummaryWindowDays(null, 0)).toBe(1)
  })
})

// The parser gates the date params of every availability route (day,
// alternates, bootstrap, pro busy-days). It was made STRICT in R4 when the
// busy-days route's own strict parser was consolidated into it — these pin the
// strictness directly so the consolidation can't silently regress
// ([[drifted-duplicate-is-a-bug-report]]).
describe('parseYYYYMMDD', () => {
  it('parses a valid date', () => {
    expect(parseYYYYMMDD('2026-09-05')).toEqual({
      year: 2026,
      month: 9,
      day: 5,
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseYYYYMMDD(' 2026-09-05 ')).toEqual({
      year: 2026,
      month: 9,
      day: 5,
    })
  })

  it('rejects a well-formed date that does not exist on the calendar', () => {
    // JS Date would roll 2026-02-31 forward to March 3 — a caller that sends
    // an impossible date wants a refusal, not a silently different day.
    expect(parseYYYYMMDD('2026-02-31')).toBeNull()
    expect(parseYYYYMMDD('2026-04-31')).toBeNull()
    expect(parseYYYYMMDD('2025-02-29')).toBeNull() // not a leap year
  })

  it('accepts Feb 29 on a leap year', () => {
    expect(parseYYYYMMDD('2028-02-29')).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    })
  })

  it('rejects malformed input', () => {
    expect(parseYYYYMMDD('nope')).toBeNull()
    expect(parseYYYYMMDD('2026-9-5')).toBeNull()
    expect(parseYYYYMMDD('2026-13-01')).toBeNull()
    expect(parseYYYYMMDD('2026-00-10')).toBeNull()
    expect(parseYYYYMMDD('2026-01-00')).toBeNull()
    expect(parseYYYYMMDD(null)).toBeNull()
    expect(parseYYYYMMDD(undefined)).toBeNull()
  })
})

describe('ymdToString', () => {
  it('zero-pads month and day', () => {
    expect(ymdToString({ year: 2026, month: 9, day: 5 })).toBe('2026-09-05')
  })
})

describe('ymdSerial', () => {
  it('orders days across month and year boundaries', () => {
    const dec31 = ymdSerial({ year: 2026, month: 12, day: 31 })
    const jan1 = ymdSerial({ year: 2027, month: 1, day: 1 })
    expect(jan1 - dec31).toBe(1)
  })
})

describe('enumerateYmdRange', () => {
  it('returns every day in the inclusive range, ascending', () => {
    expect(
      enumerateYmdRange('2026-09-28', '2026-10-02').map(ymdToString),
    ).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
  })

  it('returns a single day for from == to', () => {
    expect(enumerateYmdRange('2026-09-01', '2026-09-01')).toHaveLength(1)
  })

  it('returns empty for an inverted or unparseable range', () => {
    expect(enumerateYmdRange('2026-09-02', '2026-09-01')).toEqual([])
    expect(enumerateYmdRange('2026-02-31', '2026-03-05')).toEqual([])
    expect(enumerateYmdRange('nope', '2026-03-05')).toEqual([])
  })

  it('stops at the maxDays backstop instead of running away', () => {
    expect(enumerateYmdRange('2020-01-01', '2030-01-01', 10)).toHaveLength(10)
  })
})
