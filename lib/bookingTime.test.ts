// lib/bookingTime.test.ts
import { describe, expect, it } from 'vitest'
import {
  datetimeLocalToUtcIsoStrict,
  partsToUtcIsoStrict,
} from './bookingTime'

describe('lib/bookingTime strict wall-clock conversion', () => {
  const tz = 'America/New_York'

  it('converts a normal datetime-local to UTC ISO', () => {
    const res = datetimeLocalToUtcIsoStrict('2026-01-15T09:30', tz)
    expect(res).toEqual({ ok: true, iso: '2026-01-15T14:30:00.000Z' })
  })

  it('reports MALFORMED for unparseable input', () => {
    expect(datetimeLocalToUtcIsoStrict('not-a-date', tz)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    })
    expect(datetimeLocalToUtcIsoStrict('', tz)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    })
  })

  it('reports DST_INVALID for a nonexistent spring-forward time', () => {
    expect(datetimeLocalToUtcIsoStrict('2026-03-08T02:30', tz)).toEqual({
      ok: false,
      reason: 'DST_INVALID',
    })
  })

  it('reports DST_INVALID for an ambiguous fall-back time', () => {
    expect(datetimeLocalToUtcIsoStrict('2026-11-01T01:30', tz)).toEqual({
      ok: false,
      reason: 'DST_INVALID',
    })
  })

  it('partsToUtcIsoStrict matches the string entry point', () => {
    const res = partsToUtcIsoStrict({
      year: 2026,
      month: 1,
      day: 15,
      hour: 9,
      minute: 30,
      timeZone: tz,
    })
    expect(res).toEqual({ ok: true, iso: '2026-01-15T14:30:00.000Z' })
  })
})
