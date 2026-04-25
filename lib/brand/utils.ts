// lib/brand/utils.ts
import type { BrandTokens } from './types'

export function toCssVars(tokens: BrandTokens): Record<string, string> {
  const { colors, effects, typography } = tokens

  // CSS rgba() needs comma-separated channels.
  // Brand tokens store RGB as space-separated triplets: "244 239 231".
  const textPrimaryRgb = colors.textPrimary.split(' ').join(', ')

  return {
    // ── Semantic names used by existing components ────────────────
    '--bg-primary': colors.bgPrimary,
    '--bg-secondary': colors.bgSecondary,
    '--bg-surface': colors.bgSurface,

    '--text-primary': colors.textPrimary,
    '--text-secondary': colors.textSecondary,
    '--text-muted': colors.textMuted,

    '--surface-glass': colors.surfaceGlass,

    '--accent-primary': colors.accentPrimary,
    '--accent-primary-hover': colors.accentPrimaryHover,
    '--micro-accent': colors.microAccent,

    '--color-acid': colors.colorAcid,
    '--color-fern': colors.colorFern,
    '--color-ember': colors.colorEmber,
    '--color-amber': colors.colorAmber,

    // ── Prototype aliases used by editorial/new screens ───────────
    '--ink': colors.bgPrimary,
    '--ink-2': colors.bgSecondary,
    '--ink-3': colors.bgSurface,

    '--paper': colors.textPrimary,
    '--paper-dim': colors.textSecondary,
    '--paper-mute': colors.textMuted,

    '--terra': colors.accentPrimary,
    '--terra-glow': colors.accentPrimaryHover,

    '--acid': colors.colorAcid,
    '--fern': colors.colorFern,
    '--ember': colors.colorEmber,
    '--amber': colors.colorAmber,

    // ── Computed borders ──────────────────────────────────────────
    '--line': `rgba(${textPrimaryRgb}, 0.08)`,
    '--line-strong': `rgba(${textPrimaryRgb}, 0.16)`,

    // ── Status tones ──────────────────────────────────────────────
    // Pending intentionally maps to prototype amber (#F0A830).
    // Do not use tone-warn here; warning and pending are visually different.
    '--tone-pending': colors.colorAmber,

    // ── Effects ───────────────────────────────────────────────────
    '--glass-blur': `${effects.glassBlurPx}px`,
    '--glass-opacity': `${effects.glassOpacity}`,
    '--shadow-color': effects.shadowColor,
    '--radius-app-icon': `${effects.radiusAppIconPx}px`,
    '--radius-card': `${effects.radiusCardPx}px`,

    // ── Typography ────────────────────────────────────────────────
    '--font-sans': typography.fontSans,
    '--font-display': typography.fontDisplay,
    '--font-mono': typography.fontMono,
    '--ls-caps': typography.letterSpacingCaps,
  }
}