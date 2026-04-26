// lib/brand/utils.ts
import type { BrandTokens, RgbTriplet } from './types'

function rgbChannels(value: RgbTriplet): string {
  return value.split(' ').join(', ')
}

export function toCssVars(tokens: BrandTokens): Record<string, string> {
  const { colors, effects, typography, layout } = tokens

  // CSS rgba() needs comma-separated channels.
  // Brand tokens store RGB as space-separated triplets: "244 239 231".
  const textPrimaryRgb = rgbChannels(colors.textPrimary)
  const shadowRgb = rgbChannels(effects.shadowColor)
  const accentRgb = rgbChannels(colors.accentPrimary)

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

    // ── Status tones ──────────────────────────────────────────────
    '--tone-danger': colors.colorEmber,
    '--tone-warn': colors.colorAmber,
    '--tone-pending': colors.colorAmber,
    '--tone-success': colors.colorFern,
    '--tone-info': colors.accentPrimary,

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

    // ── Computed borders / dividers ───────────────────────────────
    '--line': `rgba(${textPrimaryRgb}, 0.08)`,
    '--line-strong': `rgba(${textPrimaryRgb}, 0.16)`,
    '--line-heavy': `rgba(${textPrimaryRgb}, 0.24)`,

    // ── Effects ───────────────────────────────────────────────────
    '--glass-blur': `${effects.glassBlurPx}px`,
    '--glass-opacity': `${effects.glassOpacity}`,
    '--shadow-color': effects.shadowColor,

    '--shadow-soft': `0 10px 30px rgb(${shadowRgb} / 0.32)`,
    '--shadow-strong': `0 18px 55px rgb(${shadowRgb} / 0.48)`,
    '--shadow-accent': `0 10px 28px rgb(${accentRgb} / 0.38)`,

    // ── Radii ─────────────────────────────────────────────────────
    '--radius-app-icon': `${effects.radiusAppIconPx}px`,
    '--radius-card': `${effects.radiusCardPx}px`,
    '--radius-panel': `${effects.radiusPanelPx}px`,
    '--radius-sheet': `${effects.radiusSheetPx}px`,
    '--radius-inner': `${effects.radiusInnerPx}px`,
    '--radius-pill': `${effects.radiusPillPx}px`,

    // ── Typography ────────────────────────────────────────────────
    '--font-sans': typography.fontSans,
    '--font-display': typography.fontDisplay,
    '--font-mono': typography.fontMono,
    '--ls-caps': typography.letterSpacingCaps,
    '--ls-tight': typography.letterSpacingTight,

    // ── Layout ────────────────────────────────────────────────────
    '--page-max-width': `${layout.pageMaxWidthPx}px`,
    '--mobile-shell-width': `${layout.mobileShellWidthPx}px`,
    '--overlay': colors.bgPrimary,
  }
}