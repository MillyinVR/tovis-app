// lib/brand/defaults.ts
//
// Shared, brand-agnostic defaults that the createBrandConfig factory fills in
// so a white-label brand only has to provide its palette + logo + contact.
import type { BrandMode, BrandTokens, RgbTriplet } from './types'

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
