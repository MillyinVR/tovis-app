// lib/brand/contrast.ts
//
// WCAG 2.1 relative luminance and contrast, computed from brand token triplets.
//
// This exists so the palette can be held honest by tests rather than by the
// comment sitting next to a hex value — those comments have been wrong twice
// (#928 found the light accent failing in both directions while the register
// called it fine; the phase-7 role count found `colorEmber` and `colorAmber`
// below AA as text, which is the role they mostly play).
//
// ⚠️ `composite()` is the part that matters. A token's contrast on a bare
// surface is NOT the number the user sees: the app's canonical notice is
// `bg-toneDanger/10 text-toneDanger`, and in light mode that tint lightens the
// box toward the token, closing the gap. `colorEmber` read 4.09 on paper and
// 3.52 inside its own notice. Measure the pattern.
import type { RgbTriplet } from './types'

const WCAG_WEIGHTS = [0.2126, 0.7152, 0.0722]

export function channels(triplet: RgbTriplet): number[] {
  return triplet.split(' ').map((value) => Number(value))
}

export function relativeLuminance(triplet: RgbTriplet): number {
  return channels(triplet).reduce((total, value, index) => {
    const channel = value / 255
    const linear =
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

    return total + linear * (WCAG_WEIGHTS[index] ?? 0)
  }, 0)
}

export function contrastRatio(a: RgbTriplet, b: RgbTriplet): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]

  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `foreground` laid over `background` at `alpha` — the flat-ground composite a
 * translucent fill resolves to. Rounded to whole channels, because that is what
 * the browser rasterises and what a screenshot would read back.
 *
 * Validated against a real composited-pixel measurement: `colorEmber` at 0.1
 * over the light page ground gives 3.52, which is exactly what #931 read out of
 * the rendered notice.
 */
export function composite(
  foreground: RgbTriplet,
  background: RgbTriplet,
  alpha: number,
): RgbTriplet {
  const fg = channels(foreground)
  const bg = channels(background)
  const blend = (index: number): number =>
    Math.round((fg[index] ?? 0) * alpha + (bg[index] ?? 0) * (1 - alpha))

  // Built as three numbers rather than a join, so the result satisfies
  // RgbTriplet's template-literal type without an assertion.
  return `${blend(0)} ${blend(1)} ${blend(2)}`
}

/** WCAG 2.1 SC 1.4.3 — normal-size body text. */
export const TEXT_CONTRAST_FLOOR = 4.5

/** WCAG 2.1 SC 1.4.11 — non-text: icons, boundaries, meaningful graphics. */
export const NON_TEXT_CONTRAST_FLOOR = 3

/** The alpha the app's canonical tone notice fills with. */
export const NOTICE_TINT_ALPHA = 0.1
