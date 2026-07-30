// lib/brand/defaults.ts
//
// Shared, brand-agnostic defaults that the createBrandConfig factory fills in
// so a white-label brand only has to provide its palette + logo + contact.
import type {
  BrandCalendarSwatches,
  BrandMode,
  BrandTokens,
  RgbTriplet,
} from './types'

// The Grotesk trio loaded via next/font in app/layout.tsx (--font-body /
// --font-display-face / --font-mono-face). A white-label brand inherits these
// unless it also wires its own next/font faces into those vars in the layout.
export const DEFAULT_FONT_SANS =
  'var(--font-body), "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const DEFAULT_FONT_DISPLAY =
  'var(--font-display-face), "Space Grotesk", ui-sans-serif, system-ui, sans-serif'
export const DEFAULT_FONT_MONO =
  'var(--font-mono-face), "Space Mono", ui-monospace, "Cascadia Code", "Fira Code", monospace'

export const DEFAULT_TYPOGRAPHY: BrandTokens['typography'] = {
  fontSans: DEFAULT_FONT_SANS,
  fontDisplay: DEFAULT_FONT_DISPLAY,
  fontMono: DEFAULT_FONT_MONO,
  letterSpacingCaps: '0.08em',
  letterSpacingTight: '-0.03em',
}

export const DEFAULT_LAYOUT: BrandTokens['layout'] = {
  pageMaxWidthPx: 960,
  mobileShellWidthPx: 430,
}

/**
 * The default per-service calendar palette (K7) → `--swatch-01` … `--swatch-12`.
 *
 * Twelve hues at ~30° spacing, generated rather than eyeballed: within a mode
 * every swatch is tuned to the SAME WCAG relative luminance (dark ≈ 0.30,
 * light ≈ 0.115) so no service shouts louder than another and all twelve clear
 * the 3:1 non-text contrast floor against every calendar surface by a wide
 * margin — measured ≥ 5.17:1 in light and ≥ 5.58:1 in dark against
 * `bgPrimary` / `bgSecondary` / `bgSurface`. Pinned by defaults.test.ts, which
 * recomputes the contrast rather than trusting this comment.
 *
 * The light set is dark-on-paper and the dark set is bright-on-ink: the same
 * swatch id is the same *hue* in both modes, never the same triplet, because a
 * colour that reads on ink disappears on paper.
 *
 * ⚠️ These are a separate channel from the status tones on purpose — status
 * owns the card fill, service owns the 4px accent stripe (decision D2). Some
 * swatch hues necessarily sit near a brand hue (there are only so many hues);
 * the channel split, not hue avoidance, is what keeps them readable.
 */
export const DEFAULT_CALENDAR_SWATCHES: Record<BrandMode, BrandCalendarSwatches> =
  {
    dark: {
      '01': '247 101 96', // #F76560 coral
      '02': '222 123 41', // #DE7B29 orange
      '03': '185 143 41', // #B98F29 ochre
      '04': '136 158 40', // #889E28 olive
      '05': '45 170 94', // #2DAA5E green
      '06': '45 166 152', // #2DA698 teal
      '07': '45 162 186', // #2DA2BA cyan
      '08': '44 155 234', // #2C9BEA azure
      '09': '125 141 245', // #7D8DF5 periwinkle
      '10': '182 120 245', // #B678F5 violet
      '11': '247 66 239', // #F742EF magenta
      '12': '247 92 163', // #F75CA3 rose
    },
    light: {
      '01': '189 21 35', // #BD1523 coral
      '02': '147 77 13', // #934D0D orange
      '03': '120 91 13', // #785B0D ochre
      '04': '86 102 13', // #56660D olive
      '05': '15 110 56', // #0F6E38 green
      '06': '16 107 98', // #106B62 teal
      '07': '15 104 121', // #0F6879 cyan
      '08': '15 100 155', // #0F649B azure
      '09': '74 61 248', // #4A3DF8 periwinkle
      '10': '141 25 219', // #8D19DB violet
      '11': '168 21 163', // #A815A3 magenta
      '12': '182 20 109', // #B6146D rose
    },
  }

/** Radii/glass/shadow defaults. Glass is a touch softer in light mode. */
export function defaultEffects(
  mode: BrandMode,
  shadowColor: RgbTriplet,
): BrandTokens['effects'] {
  return {
    glassBlurPx: mode === 'dark' ? 20 : 18,
    glassOpacity: mode === 'dark' ? 0.09 : 0.07,
    shadowColor,
    radiusAppIconPx: 22,
    radiusCardPx: 18,
    radiusPanelPx: 18,
    radiusSheetPx: 24,
    radiusInnerPx: 8,
    radiusPillPx: 999,
  }
}
