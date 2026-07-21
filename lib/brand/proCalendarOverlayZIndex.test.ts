// lib/brand/proCalendarOverlayZIndex.test.ts
//
// The pro calendar's overlays are styled in plain CSS, so they can't import
// `Z` from lib/zIndex — nothing stops a hand-written z-index from drifting back
// under the global footer nav. That regression is invisible in every unit test
// and only shows up as "the modal's save button is unclickable", so pin the
// ladder here.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { Z } from '@/lib/zIndex'

const CSS_PATH = path.join(process.cwd(), 'lib/brand/proCalendar.css')

/**
 * Every calendar surface that covers the page and must therefore out-stack the
 * fixed footer nav. Keyed by selector so a failure names the offending rule.
 */
const FULL_SCREEN_OVERLAY_SELECTORS = [
  '.brand-pro-calendar-booking-overlay',
  '.brand-pro-calendar-management-overlay',
  '.brand-pro-calendar-block-overlay',
  '.brand-pro-calendar-desktop-edit-overlay',
  '.brand-pro-calendar-edit-schedule-overlay',
] as const

function readCss(): string {
  return fs.readFileSync(CSS_PATH, 'utf8')
}

/**
 * Highest z-index declared for `selector` across all its rule blocks (later
 * blocks and media queries can override an earlier one).
 */
function declaredZIndexes(css: string, selector: string): number[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // `m` so a rule that starts its own line still matches when the preceding
  // line is a comment (`*/`) rather than a brace.
  const blockPattern = new RegExp(
    `(?:^|[,{}])[ \\t]*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`,
    'gm',
  )

  const values: number[] = []

  for (const match of css.matchAll(blockPattern)) {
    const zIndexMatch = /z-index:\s*(-?\d+)/.exec(match[1] ?? '')
    if (zIndexMatch) values.push(Number(zIndexMatch[1]))
  }

  return values
}

describe('pro calendar overlay z-index ladder', () => {
  const css = readCss()

  it.each(FULL_SCREEN_OVERLAY_SELECTORS)(
    '%s stacks above the global footer nav and below the modal tier',
    (selector) => {
      const values = declaredZIndexes(css, selector)

      expect(values, `${selector} declares no z-index`).not.toHaveLength(0)

      for (const value of values) {
        // Above the footer, or the footer covers the overlay's own buttons.
        expect(value, `${selector} z-index ${value}`).toBeGreaterThanOrEqual(
          Z.overlay,
        )
        // Below the modal tier, so ConfirmChangeModal / the override prompts
        // (zClass.modal) still open on top of these overlays.
        expect(value, `${selector} z-index ${value}`).toBeLessThan(Z.modal)
      }
    },
  )
})
