// lib/brand/utils.ts
import type { BrandTokens } from './types'

export function toCssVars(tokens: BrandTokens): Record<string, string> {
  const { colors, effects, typography } = tokens

  // --line / --line-strong are derived from textPrimary at fixed opacities
  const [r, g, b] = colors.textPrimary.split(' ')

  return {
    // ── Semantic names (used by existing components) ──────────────
    '--bg-primary':           colors.bgPrimary,
    '--bg-secondary':         colors.bgSecondary,
    '--bg-surface':           colors.bgSurface,
    '--text-primary':         colors.textPrimary,
    '--text-secondary':       colors.textSecondary,
    '--text-muted':           colors.textMuted,
    '--surface-glass':        colors.surfaceGlass,
    '--accent-primary':       colors.accentPrimary,
    '--accent-primary-hover': colors.accentPrimaryHover,
    '--micro-accent':         colors.microAccent,
    '--color-acid':           colors.colorAcid,
    '--color-fern':           colors.colorFern,
    '--color-ember':          colors.colorEmber,

    // ── Prototype aliases (used by new screens) ───────────────────
    '--ink':        colors.bgPrimary,
    '--ink-2':      colors.bgSecondary,
    '--ink-3':      colors.bgSurface,
    '--paper':      colors.textPrimary,
    '--paper-dim':  colors.textSecondary,
    '--paper-mute': colors.textMuted,
    '--terra':      colors.accentPrimary,
    '--terra-glow': colors.accentPrimaryHover,
    '--acid':       colors.colorAcid,
    '--fern':       colors.colorFern,
    '--ember':      colors.colorEmber,

    // ── Computed borders (paper at fixed opacity) ─────────────────
    '--line':        `rgba(${r},${g},${b},0.08)`,
    '--line-strong': `rgba(${r},${g},${b},0.16)`,

    // ── Effects ───────────────────────────────────────────────────
    '--glass-blur':      `${effects.glassBlurPx}px`,
    '--glass-opacity':   `${effects.glassOpacity}`,
    '--shadow-color':    effects.shadowColor,
    '--radius-app-icon': `${effects.radiusAppIconPx}px`,
    '--radius-card':     `${effects.radiusCardPx}px`,

    // ── Typography ────────────────────────────────────────────────
    '--font-sans': typography.fontSans,
    '--font-mono': typography.fontMono,
    '--ls-caps':   typography.letterSpacingCaps,
  }
}
