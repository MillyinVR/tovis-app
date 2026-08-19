import { describe, expect, it } from 'vitest'

import { relativeDayPhrase, wholeDaysUntil } from './relativeWhen'

const AT = (iso: string) => new Date(iso)

describe('wholeDaysUntil', () => {
  it('counts whole days between two instants', () => {
    expect(
      wholeDaysUntil(AT('2026-08-25T00:00:00Z'), AT('2026-08-18T00:00:00Z')),
    ).toBe(7)
  })

  it('rounds a partial day UP, so a gap of 6d12h still reads as 7', () => {
    expect(
      wholeDaysUntil(AT('2026-08-25T00:00:00Z'), AT('2026-08-18T12:00:00Z')),
    ).toBe(7)
  })

  it('floors at 1 — a sub-day gap never reads as 0 days', () => {
    expect(
      wholeDaysUntil(AT('2026-08-18T01:00:00Z'), AT('2026-08-18T00:00:00Z')),
    ).toBe(1)
  })

  it('floors at 1 for a target already in the past', () => {
    expect(
      wholeDaysUntil(AT('2026-08-10T00:00:00Z'), AT('2026-08-18T00:00:00Z')),
    ).toBe(1)
  })
})

describe('relativeDayPhrase', () => {
  it('says "tomorrow" for a single day', () => {
    expect(relativeDayPhrase(1)).toBe('tomorrow')
  })

  it('says "in N days" for anything else', () => {
    expect(relativeDayPhrase(2)).toBe('in 2 days')
    expect(relativeDayPhrase(30)).toBe('in 30 days')
  })

  it('does NOT special-case a week — that wording is local to appointment reminders', () => {
    expect(relativeDayPhrase(7)).toBe('in 7 days')
  })
})
