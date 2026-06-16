// lib/brand/createBrand.ts
//
// White-label brand factory. A new tenant brand is defined by its palette
// (full dark + light color sets), logo/wordmark, contact, and name — the
// factory fills in everything else (radii/glass/shadow effects, the Grotesk
// typography, layout, and the shared pro-calendar product copy). See
// docs/design/white-label-runbook.md and lib/brand/brands/_template.ts.
import type { BrandConfig, BrandMode, BrandTokens, RgbTriplet } from './types'
import { DEFAULT_LAYOUT, DEFAULT_TYPOGRAPHY, defaultEffects } from './defaults'
import { defaultProCalendarCopy } from './defaultProCalendarCopy'

export type CreateBrandInput = {
  id: string
  displayName: string
  tagline?: string
  defaultMode?: BrandMode
  assets: BrandConfig['assets']
  contact: BrandConfig['contact']
  /** The palette — full color sets for both modes. The "give me a palette" input. */
  colors: { dark: BrandTokens['colors']; light: BrandTokens['colors'] }

  // ── Optional overrides (rarely needed) ──────────────────────────────
  /** Shadow tint; defaults to the dark background (deep-ink shadows). */
  shadowColor?: RgbTriplet
  typography?: Partial<BrandTokens['typography']>
  layout?: Partial<BrandTokens['layout']>
  effects?: {
    dark?: Partial<BrandTokens['effects']>
    light?: Partial<BrandTokens['effects']>
  }
  /** Override the shared pro-calendar copy (defaults to the standard product copy). */
  proCalendar?: BrandConfig['proCalendar']
}

export function createBrandConfig(input: CreateBrandInput): BrandConfig {
  const shadowColor = input.shadowColor ?? input.colors.dark.bgPrimary
  const typography = { ...DEFAULT_TYPOGRAPHY, ...input.typography }
  const layout = { ...DEFAULT_LAYOUT, ...input.layout }

  const buildTokens = (mode: BrandMode): BrandTokens => ({
    colors: input.colors[mode],
    effects: { ...defaultEffects(mode, shadowColor), ...input.effects?.[mode] },
    typography,
    layout,
  })

  return {
    id: input.id,
    displayName: input.displayName,
    tagline: input.tagline,
    defaultMode: input.defaultMode ?? 'dark',
    assets: input.assets,
    contact: input.contact,
    proCalendar:
      input.proCalendar ?? defaultProCalendarCopy(input.assets.wordmark.text),
    tokensByMode: {
      dark: buildTokens('dark'),
      light: buildTokens('light'),
    },
  }
}
