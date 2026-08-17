// lib/brand/toneTokenContrast.test.ts
//
// The status tones are TEXT tokens. The phase-7 role count (on `72def5a7`)
// measured every site each one paints:
//
//   colorEmber   518 sites — 238 TEXT, 128 fill, 149 border
//   colorAmber   258 sites —  93 TEXT,  71 fill,  91 border
//   microAccent   84 sites —  42 TEXT,  28 fill,  13 border
//
// and 371 of those 373 text sites are at FULL opacity, while the fills are
// `/10` and the borders `/20`–`/50`. So the token's own value is the governing
// number for exactly the role that was failing, and it is worth a guard.
//
// ⚠️ The bar has to be applied to the PATTERN, not the token on a bare surface.
// The app writes `bg-toneDanger/10 text-toneDanger` 62 times across 46 files;
// in light mode that tint lightens the box toward the token and closes the gap.
// `colorEmber` was 4.09 on paper and 3.52 inside its own notice — the register
// scoped a whole phase around the 4.09 and never measured the 3.52.
import { describe, expect, it } from 'vitest'

import {
  NOTICE_TINT_ALPHA,
  TEXT_CONTRAST_FLOOR,
  composite,
  contrastRatio,
} from './contrast'
import { tovisBrand } from './brands/tovis'
import { toCssVars } from './utils'
import type { BrandMode, BrandTokens, RgbTriplet } from './types'

const MODES: BrandMode[] = ['dark', 'light']

/**
 * Derived from `toCssVars`, not hand-listed: a thirteenth tone added there is
 * covered here the day it lands, rather than the day somebody remembers.
 */
const TONE_VARS = ['--tone-danger', '--tone-warn', '--tone-pending', '--tone-success', '--tone-info']

function toneTokens(mode: BrandMode): Map<string, RgbTriplet> {
  const vars = toCssVars(tovisBrand.tokensByMode[mode])
  return new Map(TONE_VARS.map((name) => [name, vars[name] as RgbTriplet]))
}

function grounds(mode: BrandMode): Array<[string, RgbTriplet]> {
  const { bgPrimary, bgSecondary, bgSurface } = tovisBrand.tokensByMode[mode].colors
  return [
    ['bgPrimary', bgPrimary],
    ['bgSecondary', bgSecondary],
    ['bgSurface', bgSurface],
  ]
}

/**
 * Tones that do NOT yet clear AA as text, per mode, each with the reason. All
 * of these predate this file; raising them is Tori's call, not a sweep's, and
 * the numbers are with her.
 *
 *  - LIGHT `--tone-info` is `accentPrimary`. #928 raised it to #0A7363, which
 *    clears 4.5 on every bare surface (5.06 on paper) but reaches only 4.43
 *    inside the tint — #928 measured the token, not the pattern, exactly as the
 *    register did for ember.
 *  - ~~`--tone-success` (`colorFern`)~~ **FIXED.** It failed in BOTH modes —
 *    light 4.32 in a notice on the band, and dark 4.45 bare on `bgSecondary`
 *    with 4.24 / 3.98 / 3.75 inside its own notice, i.e. every dark ground,
 *    in the app's DEFAULT mode. Raised to `#0AA49E` dark / `#0D6860` light
 *    (worst reading 4.76 / 4.71). All 66 of its text sites are at full
 *    opacity, so the token's own value governed exactly the failing role.
 *    ⚠️ That fix REQUIRED a second change and cannot be reverted alone: the
 *    calendar's mobile Approve button paints a ✓ on a SOLID fill of this
 *    token, which pulls the opposite way — on the raised green `textPrimary`
 *    reads 2.68 / 2.82, below even the 3:1 bar an aria-labelled glyph owes.
 *    It moved to `--on-accent` in proCalendar.css. See
 *    `toneOnSolidFill.test.ts`, which exists because THIS suite could not see
 *    that surface: it checks tones against grounds and tints, never against a
 *    foreground sitting on the tone itself.
 *
 * ⚠️ This list FAILS when an entry starts passing. A known-shortfall list that
 * silently goes stale is how a fixed thing keeps being described as broken.
 */
const KNOWN_BELOW_AA: Record<BrandMode, Set<string>> = {
  light: new Set(['--tone-info']),
  dark: new Set(),
}

describe('status tone tokens', () => {
  it.each(MODES)('clears AA as body text on every bare %s surface', (mode) => {
    for (const [name, token] of toneTokens(mode)) {
      if (KNOWN_BELOW_AA[mode].has(name)) continue

      for (const [label, ground] of grounds(mode)) {
        expect(
          contrastRatio(token, ground),
          `${name} on ${label} in ${mode}`,
        ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)
      }
    }
  })

  // The canonical notice: the glyph sits on its own colour at 10% over the
  // surface, never on the bare surface.
  it.each(MODES)('clears AA INSIDE its own tinted notice in %s', (mode) => {
    for (const [name, token] of toneTokens(mode)) {
      if (KNOWN_BELOW_AA[mode].has(name)) continue

      for (const [label, ground] of grounds(mode)) {
        const box = composite(token, ground, NOTICE_TINT_ALPHA)

        expect(
          contrastRatio(token, box),
          `${name} inside its own notice on ${label} in ${mode}`,
        ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR)
      }
    }
  })

  it.each(MODES)(
    'keeps the %s known-shortfall list honest — an entry that now passes must be removed',
    (mode) => {
      const tokens = toneTokens(mode)

      for (const name of KNOWN_BELOW_AA[mode]) {
        const token = tokens.get(name)
        expect(token, `${name} is no longer a tone var`).toBeDefined()

        const worst = Math.min(
          ...grounds(mode).flatMap(([, ground]) => [
            contrastRatio(token as RgbTriplet, ground),
            contrastRatio(
              token as RgbTriplet,
              composite(token as RgbTriplet, ground, NOTICE_TINT_ALPHA),
            ),
          ]),
        )

        expect(
          worst,
          `${name} now clears AA in ${mode} — delete it from KNOWN_BELOW_AA.${mode}`,
        ).toBeLessThan(TEXT_CONTRAST_FLOOR)
      }
    },
  )

  // 🔴 `colorAmber` and `microAccent` carried the SAME triplet until the status
  // gold had to become readable. They are separate fields on BrandTokens and
  // they are separate on purpose: `colorAmber` drives --tone-warn/--tone-pending
  // and must clear AA as text; `microAccent` drives --micro-accent/--gold, is
  // the brand's second colour. Both are now raised, to DIFFERENT values, so
  // re-unifying them would silently undo either fix — pin the split.
  it('splits the status gold from the brand gold in light mode', () => {
    const { colorAmber, microAccent } = tovisBrand.tokensByMode.light.colors

    expect(colorAmber).not.toBe(microAccent)
    expect(microAccent).toBe('117 84 21')
  })

  it('leaves them identical in dark, where both already clear AA', () => {
    const { colorAmber, microAccent } = tovisBrand.tokensByMode.dark.colors

    expect(colorAmber).toBe(microAccent)
  })

  // A token only matters if it reaches the stylesheet. BrandProvider emits
  // `[data-mode="light"]{…}` straight from toCssVars, so this is the shipped
  // value, not the source one.
  it('emits the fixed values into the light CSS vars every alias reaches', () => {
    const light = toCssVars(tovisBrand.tokensByMode.light)
    const { colorEmber, colorAmber } = tovisBrand.tokensByMode.light.colors

    // ember → danger tone, its own name, and the `like` heart
    for (const name of ['--tone-danger', '--color-ember', '--ember']) {
      expect(light[name], name).toBe(colorEmber)
    }

    // amber → both status tones and its own name
    for (const name of ['--tone-warn', '--tone-pending', '--color-amber', '--amber']) {
      expect(light[name], name).toBe(colorAmber)
    }

    // and the brand gold did NOT move with them
    expect(light['--micro-accent']).toBe('117 84 21')
    expect(light['--tone-warn']).not.toBe(light['--micro-accent'])
  })

  it('leaves the dark palette untouched', () => {
    const dark = tovisBrand.tokensByMode.dark.colors satisfies BrandTokens['colors']

    expect(dark.colorEmber).toBe('255 61 110')
    expect(dark.colorAmber).toBe('242 180 62')
    expect(dark.microAccent).toBe('242 180 62')
  })
})
