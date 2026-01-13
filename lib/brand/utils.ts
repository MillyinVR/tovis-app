// lib/brand/utils.ts
import type { BrandTokens } from './types'

export function toCssVars(tokens: BrandTokens): Record<string, string> {
  const { colors, effects, typography } = tokens

  return {
    // Colors (RGB triplets)
    '--bg-primary': colors.bgPrimary,
    '--bg-secondary': colors.bgSecondary,
    '--text-primary': colors.textPrimary,
    '--text-secondary': colors.textSecondary,
    '--surface-glass': colors.surfaceGlass,
    '--accent-primary': colors.accentPrimary,
    '--accent-primary-hover': colors.accentPrimaryHover,
    '--micro-accent': colors.microAccent,

    // Effects
    '--glass-blur': `${effects.glassBlurPx}px`,
    '--glass-opacity': `${effects.glassOpacity}`,
    '--shadow-color': effects.shadowColor,
    '--radius-app-icon': `${effects.radiusAppIconPx}px`,
    '--radius-card': `${effects.radiusCardPx}px`,

    // Type
    '--font-sans': typography.fontSans,
    '--ls-caps': typography.letterSpacingCaps,
  }
}
