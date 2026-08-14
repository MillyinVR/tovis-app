import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TIP_PERCENTS,
  normalizeTipSuggestionPercents,
  resolveTipPresetPercents,
} from '@/lib/payments/tipSuggestions'

describe('normalizeTipSuggestionPercents', () => {
  it('reads the { label, percent } rows the pro editor actually saves', () => {
    // 🔴 THE REGRESSION THIS MODULE EXISTS FOR. `ClientCheckoutCard` used to
    // carry its own copy that understood only bare numbers, so a pro who
    // configured 18/22/25 was served the platform's 15/20/25 on web while iOS
    // showed the real thing. Their setting was silently ignored.
    expect(
      normalizeTipSuggestionPercents([
        { label: '18%', percent: 18 },
        { label: '22%', percent: 22 },
        { label: '25%', percent: 25 },
      ]),
    ).toEqual([18, 22, 25])
  })

  it('still accepts the legacy bare-number and string shapes', () => {
    expect(normalizeTipSuggestionPercents([10, '15', 20])).toEqual([10, 15, 20])
  })

  it('keeps the order the pro wrote and drops repeats', () => {
    expect(normalizeTipSuggestionPercents([25, 15, 25, 20])).toEqual([25, 15, 20])
  })

  it('drops values that could not be a tip', () => {
    // A "150% tip" chip is a data bug, not an offer; a row with no percent is
    // not a suggestion at all.
    expect(
      normalizeTipSuggestionPercents([
        150,
        -5,
        'abc',
        null,
        { label: 'no percent' },
        { label: '20%', percent: 20 },
      ]),
    ).toEqual([20])
  })

  it('truncates a fractional percent rather than guessing', () => {
    expect(normalizeTipSuggestionPercents([18.7])).toEqual([18])
  })

  it('answers empty for anything that is not a list', () => {
    expect(normalizeTipSuggestionPercents(null)).toEqual([])
    expect(normalizeTipSuggestionPercents(undefined)).toEqual([])
    expect(normalizeTipSuggestionPercents('20')).toEqual([])
  })
})

describe('resolveTipPresetPercents', () => {
  it('falls back to the platform defaults when nothing is configured', () => {
    expect(resolveTipPresetPercents(true)).toEqual([...DEFAULT_TIP_PERCENTS])
    expect(resolveTipPresetPercents(null)).toEqual([...DEFAULT_TIP_PERCENTS])
    expect(resolveTipPresetPercents(undefined)).toEqual([...DEFAULT_TIP_PERCENTS])
  })

  it('suppresses the chips outright on false', () => {
    expect(resolveTipPresetPercents(false)).toEqual([])
  })

  it('🔴 treats an EMPTY list as a choice, not as absence', () => {
    // A pro who deleted every suggestion chose to have none. Restoring
    // 15/20/25 here would put back exactly what they removed.
    expect(resolveTipPresetPercents([])).toEqual([])
  })

  it("prefers the pro's own percentages over the defaults", () => {
    expect(resolveTipPresetPercents([{ label: '18%', percent: 18 }])).toEqual([18])
  })
})
