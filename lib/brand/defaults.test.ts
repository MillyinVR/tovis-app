// lib/brand/defaults.test.ts
//
// The calendar swatch palette is a CONTRAST claim, not a taste one: twelve hues
// that must all stay legible as a 4px stripe on every calendar surface, in both
// modes. Raw colours are not caught by any static guard, so this suite is the
// guard — it recomputes WCAG contrast from the token values rather than
// trusting the comment next to them.
import { describe, expect, it } from 'vitest'

import { CALENDAR_SWATCH_IDS } from '@/lib/calendar/eventColor'
import { DEFAULT_CALENDAR_SWATCHES } from './defaults'
import { tovisBrand } from './brands/tovis'
import type { BrandMode, RgbTriplet } from './types'

function channels(triplet: RgbTriplet): number[] {
  return triplet.split(' ').map((value) => Number(value))
}

const WCAG_WEIGHTS = [0.2126, 0.7152, 0.0722]

function relativeLuminance(triplet: RgbTriplet): number {
  return channels(triplet).reduce((total, value, index) => {
    const channel = value / 255
    const linear =
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

    return total + linear * (WCAG_WEIGHTS[index] ?? 0)
  }, 0)
}

function contrastRatio(a: RgbTriplet, b: RgbTriplet): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]

  return (hi + 0.05) / (lo + 0.05)
}

/** WCAG 2.1 SC 1.4.11 — non-text contrast. The stripe carries meaning. */
const NON_TEXT_CONTRAST_FLOOR = 3

const MODES: BrandMode[] = ['dark', 'light']

describe('DEFAULT_CALENDAR_SWATCHES', () => {
  it('defines exactly the ids the resolver accepts, in both modes', () => {
    for (const mode of MODES) {
      expect(Object.keys(DEFAULT_CALENDAR_SWATCHES[mode]).sort()).toEqual(
        [...CALENDAR_SWATCH_IDS].sort(),
      )
    }
  })

  it('stores every swatch as an in-range RGB triplet', () => {
    for (const mode of MODES) {
      for (const id of CALENDAR_SWATCH_IDS) {
        const parsed = channels(DEFAULT_CALENDAR_SWATCHES[mode][id])

        expect(parsed).toHaveLength(3)

        for (const value of parsed) {
          expect(Number.isInteger(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(255)
        }
      }
    }
  })

  // The three surfaces a swatch stripe or picker chip can sit on.
  it.each(MODES)(
    'clears the non-text contrast floor on every %s calendar surface',
    (mode) => {
      const { bgPrimary, bgSecondary, bgSurface } = tovisBrand.tokensByMode[mode].colors

      for (const id of CALENDAR_SWATCH_IDS) {
        const swatch = DEFAULT_CALENDAR_SWATCHES[mode][id]

        for (const background of [bgPrimary, bgSecondary, bgSurface]) {
          expect(
            contrastRatio(swatch, background),
            `swatch-${id} on ${background} in ${mode}`,
          ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST_FLOOR)
        }
      }
    },
  )

  it('weights all twelve equally — no swatch shouts louder than another', () => {
    for (const mode of MODES) {
      const luminances = CALENDAR_SWATCH_IDS.map((id) =>
        relativeLuminance(DEFAULT_CALENDAR_SWATCHES[mode][id]),
      )

      const spread = Math.max(...luminances) - Math.min(...luminances)

      expect(spread, `luminance spread in ${mode}`).toBeLessThan(0.02)
    }
  })

  it('is a genuinely per-mode palette — a swatch never reuses its own value across modes', () => {
    for (const id of CALENDAR_SWATCH_IDS) {
      expect(DEFAULT_CALENDAR_SWATCHES.dark[id]).not.toBe(
        DEFAULT_CALENDAR_SWATCHES.light[id],
      )
    }
  })

  it('keeps the twelve distinguishable from each other within a mode', () => {
    for (const mode of MODES) {
      const seen = new Set(
        CALENDAR_SWATCH_IDS.map((id) => DEFAULT_CALENDAR_SWATCHES[mode][id]),
      )

      expect(seen.size).toBe(CALENDAR_SWATCH_IDS.length)
    }
  })

  it('reaches a brand as tokens, so [data-mode] flips it', () => {
    for (const mode of MODES) {
      expect(tovisBrand.tokensByMode[mode].calendarSwatches).toEqual(
        DEFAULT_CALENDAR_SWATCHES[mode],
      )
    }
  })
})
