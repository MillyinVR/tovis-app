// lib/formatInTimeZone.test.ts
import { describe, expect, it } from 'vitest'

import { DISPLAY_LOCALE } from './locale'
import {
  formatAppointmentWhen,
  formatDatedAppointmentWhen,
  formatInTimeZone,
  formatRangeInTimeZone,
} from './formatInTimeZone'

// A fixed UTC instant: 2026-06-15T20:30:00Z.
const INSTANT = new Date('2026-06-15T20:30:00.000Z')

// An omitted locale used to reach `Intl` as `undefined`, which resolves to the
// RUNTIME's default: `LANG`/`LC_ALL` on the server and the VISITOR's browser
// locale in the client bundle. These assert the literal STRING rather than a
// round-trip through DISPLAY_LOCALE — comparing the output to
// `formatInTimeZone(…, DISPLAY_LOCALE)` would pass just as happily if both
// sides were the runtime's choice, which is a test that cannot fail.
describe('the display locale is pinned, not inherited from the runtime', () => {
  it('formats a date the American way with no locale argument', () => {
    expect(
      formatInTimeZone(INSTANT, 'UTC', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    ).toBe('Mon, Jun 15')
  })

  it('uses a 12-hour clock with no locale argument', () => {
    // The `en-GB` reading of the same instant is "20:30"; that is the diff a
    // real browser showed on /pro/bookings before this default landed.
    //
    // The separator before PM is matched as a class, not a byte: ICU 72–76
    // emit U+202F there and ICU 78 a plain space, so pinning it exactly would
    // make this test a report on the runner's ICU build rather than on the
    // locale. The 12-vs-24-hour choice is the thing under test.
    expect(
      formatInTimeZone(INSTANT, 'UTC', { hour: 'numeric', minute: '2-digit' }),
    ).toMatch(/^8:30[\s\u00a0\u202f]PM$/)
  })

  it('pins the appointment helpers too', () => {
    expect(formatAppointmentWhen(INSTANT, 'UTC')).toMatch(
      /^Mon, Jun 15, 8:30[\s\u00a0\u202f]PM$/,
    )
    expect(formatDatedAppointmentWhen(INSTANT, 'UTC')).toMatch(
      /^Mon, Jun 15, 2026, 8:30[\s\u00a0\u202f]PM$/,
    )
  })

  it('treats an explicitly-undefined locale as the default, not as the runtime', () => {
    // Helpers that forward an optional `locale` (formatSlotLabel and friends)
    // hand `undefined` down. A default parameter catches it; `locale ?? …`
    // inside the body would too, but an untyped pass-through would not.
    const forwarded: string | undefined = undefined
    expect(formatInTimeZone(INSTANT, 'UTC', { weekday: 'long' }, forwarded)).toBe(
      'Monday',
    )
  })

  it('still honours an explicit locale — the default is a default, not a lock', () => {
    expect(formatInTimeZone(INSTANT, 'UTC', { weekday: 'long' }, 'fr-FR')).toBe('lundi')
  })

  it('DISPLAY_LOCALE is the value those outputs came from', () => {
    expect(DISPLAY_LOCALE).toBe('en-US')
  })
})

describe('formatInTimeZone (memoized formatter)', () => {
  it('formats a known instant correctly per timezone', () => {
    // 20:30 UTC → 16:30 in New York (EDT, UTC-4), 13:30 in Los Angeles (PDT).
    expect(
      formatInTimeZone(INSTANT, 'America/New_York', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toBe('16:30')
    expect(
      formatInTimeZone(INSTANT, 'America/Los_Angeles', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toBe('13:30')
  })

  it('is independent of option property order (stable cache key)', () => {
    const a = formatInTimeZone(INSTANT, 'UTC', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const b = formatInTimeZone(INSTANT, 'UTC', {
      year: 'numeric',
      day: 'numeric',
      month: 'short',
    })
    expect(a).toBe(b)
  })

  it('keeps distinct timezones / options / locales distinct', () => {
    const ny = formatInTimeZone(INSTANT, 'America/New_York', { hour: 'numeric' })
    const utc = formatInTimeZone(INSTANT, 'UTC', { hour: 'numeric' })
    expect(ny).not.toBe(utc)

    const enUs = formatInTimeZone(INSTANT, 'UTC', { weekday: 'long' }, 'en-US')
    const frFr = formatInTimeZone(INSTANT, 'UTC', { weekday: 'long' }, 'fr-FR')
    expect(enUs).not.toBe(frFr)
  })

  it('returns identical output on repeated (cached) calls', () => {
    const opts = { dateStyle: 'medium', timeStyle: 'short' } as const
    const first = formatInTimeZone(INSTANT, 'America/Chicago', opts)
    const second = formatInTimeZone(INSTANT, 'America/Chicago', opts)
    expect(first).toBe(second)
  })

  it('returns "Invalid date" for unparseable input', () => {
    expect(formatInTimeZone('nonsense', 'UTC', { hour: 'numeric' })).toBe(
      'Invalid date',
    )
  })
})

describe('formatRangeInTimeZone', () => {
  it('renders a zoned start → end range', () => {
    const end = new Date('2026-06-15T21:45:00.000Z')
    const out = formatRangeInTimeZone(INSTANT, end, 'UTC')
    expect(out).toContain('→')
    expect(out).toContain('Jun 15')
  })
})
