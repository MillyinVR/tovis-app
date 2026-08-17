// lib/brand/toneOnSolidFill.test.ts
//
// The blind spot that let the `--tone-success` fix nearly ship broken.
//
// `toneTokenContrast.test.ts` checks each tone against the page GROUNDS and
// inside its own `/10` tint. Both of those ask "can you read the tone?" — the
// tone is the foreground. It has no way to see the opposite arrangement: a
// tone painted as a SOLID fill with something else written on top of it.
//
// That arrangement pulls the other way. Raising a tone so its text clears AA
// on a dark ground makes it a lighter fill, which pushes whatever sits ON it
// DOWN. On the raised `--tone-success`, the calendar's mobile Approve ✓ read
// 2.68 in dark and 2.82 in light against `--text-primary` — below even the 3:1
// bar an aria-labelled glyph owes. Every future tone change has the same
// exposure, so this is a guard rather than a one-off assertion.
//
// The list is SWEPT out of the CSS, not hand-written, so a tenth solid fill is
// covered the day it lands.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { NON_TEXT_CONTRAST_FLOOR, contrastRatio } from './contrast'
import { tovisBrand } from './brands/tovis'
import { toCssVars } from './utils'
import type { BrandMode, RgbTriplet } from './types'

const MODES: BrandMode[] = ['dark', 'light']
const CSS_DIR = path.join(process.cwd(), 'lib/brand')

/** A rule that paints a tone SOLID (no `/ alpha`) and writes a colour on it. */
type SolidFill = {
  file: string
  selector: string
  fillVar: string
  colorVar: string
}

function solidToneFills(): SolidFill[] {
  const found: SolidFill[] = []

  for (const entry of readdirSync(CSS_DIR)) {
    if (!entry.endsWith('.css')) continue

    const src = readFileSync(path.join(CSS_DIR, entry), 'utf8')

    // Each rule body, with the selector that introduces it.
    for (const match of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim().split('\n').pop()?.trim() ?? ''
      const body = match[2] ?? ''

      // Solid means no alpha: `rgb(var(--tone-x))`, not `rgb(var(--tone-x) / n)`.
      const fill = body.match(
        /background(?:-color)?:\s*rgb\(var\((--tone-[a-z]+)\)\)\s*;/,
      )
      if (!fill) continue

      const color = body.match(/(?:^|[\s;])color:\s*rgb\(var\((--[a-z-]+)\)\)/)
      if (!color) continue

      // `background` and `color` set to the SAME var is not a foreground on a
      // fill — it is a solid dot handing its colour to a currentColor child.
      // Both calendar stat-dots do this, and scoring them yields 1.00, which
      // would be a permanent false failure rather than a finding.
      if (color[1] === fill[1]) continue

      found.push({
        file: entry,
        selector,
        fillVar: fill[1] ?? '',
        colorVar: color[1] ?? '',
      })
    }
  }

  return found.sort(
    (a, b) => a.file.localeCompare(b.file) || a.selector.localeCompare(b.selector),
  )
}

function varsFor(mode: BrandMode): Record<string, string> {
  return toCssVars(tovisBrand.tokensByMode[mode])
}

const FILLS = solidToneFills()

describe('a tone painted SOLID, with something written on it', () => {
  it('finds the rules — an empty sweep must not pass vacuously', () => {
    expect(FILLS.length).toBeGreaterThan(0)

    // Pinned so a rule that stops matching (a refactor, a renamed var) shows up
    // as a change here rather than as silent loss of coverage.
    expect(FILLS.map((f) => `${f.file} ${f.selector}`)).toEqual([
      'proCalendar.css .brand-pro-calendar-pending-action[data-action="approve"]',
      'proSession.css .brand-pro-footer-error',
    ])
  })

  it.each(MODES)(
    'keeps its foreground clear of the non-text floor in %s',
    (mode) => {
      const vars = varsFor(mode)

      for (const fill of FILLS) {
        const background = vars[fill.fillVar] as RgbTriplet | undefined
        const foreground = vars[fill.colorVar] as RgbTriplet | undefined

        // A var this suite cannot resolve is a hole, not a pass.
        expect(background, `${fill.fillVar} unresolved`).toBeTruthy()
        expect(foreground, `${fill.colorVar} unresolved`).toBeTruthy()

        const ratio = contrastRatio(
          foreground as RgbTriplet,
          background as RgbTriplet,
        )

        expect(
          ratio,
          `${fill.file} ${fill.selector} — ${fill.colorVar} on a solid ` +
            `${fill.fillVar} reads ${ratio.toFixed(2)} in ${mode}`,
        ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST_FLOOR)
      }
    },
  )
})
