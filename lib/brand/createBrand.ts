// lib/brand/createBrand.ts
//
// White-label brand factory. A new tenant brand is defined by its palette
// (full dark + light color sets), logo/wordmark, contact, and name — the
// factory fills in everything else (radii/glass/shadow effects, the Grotesk
// typography, layout, and the shared pro-calendar product copy). See
// docs/design/white-label-runbook.md and lib/brand/brands/_template.ts.
import type { BrandConfig, BrandMode, BrandTokens, RgbTriplet } from './types'
import {
  DEFAULT_CALENDAR_SWATCHES,
  DEFAULT_LAYOUT,
  DEFAULT_TYPOGRAPHY,
  defaultEffects,
} from './defaults'
import { defaultProCalendarCopy } from './defaultProCalendarCopy'
import { defaultClientConsultBookingCopy } from './defaultClientConsultBookingCopy'
import { defaultClientConsultResultsCopy } from './defaultClientConsultResultsCopy'

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
  /**
   * Shadow tint, PER MODE. A shadow has to be darker than the surface it falls
   * on, and the two modes have different surfaces, so one triplet cannot serve
   * both — see the default below for what went wrong when it did.
   */
  shadowColor?: { dark: RgbTriplet; light: RgbTriplet }
  /**
   * Per-service calendar swatches (K7). Defaults to the shared twelve-hue
   * palette, which is already contrast-tuned for both modes — override only
   * with a full replacement set that has been checked the same way.
   */
  calendarSwatches?: {
    dark: BrandTokens['calendarSwatches']
    light: BrandTokens['calendarSwatches']
  }
  typography?: Partial<BrandTokens['typography']>
  layout?: Partial<BrandTokens['layout']>
  effects?: {
    dark?: Partial<BrandTokens['effects']>
    light?: Partial<BrandTokens['effects']>
  }
  /** Override the shared pro-calendar copy (defaults to the standard product copy). */
  proCalendar?: BrandConfig['proCalendar']
  /** Override the shared client AI-consult results copy. */
  clientConsultResults?: BrandConfig['clientConsultResults']
  clientConsultBooking?: BrandConfig['clientConsultBooking']
}

export function createBrandConfig(input: CreateBrandInput): BrandConfig {
  // 🔴 This used to be one triplet handed to BOTH modes — `colors.dark
  // .bgPrimary`, i.e. the dark page ground itself. A shadow tinted with the
  // colour of the page it falls on has nothing left to darken, so in dark mode
  // it did not render as a soft shadow, it rendered as almost nothing:
  // measured on isolated probes, a 0.78-alpha drop shadow gave 12.0 units of
  // separation from the page as black and 1.7 on this token. Every site on
  // `--shadow-color`, plus `--shadow-soft` and `--shadow-strong`, was affected,
  // which is also why ~48 sites still hand-write a raw black shadow instead.
  //
  // Light mode was never the problem (the same swap costs 3–10 units out of
  // 50–157 there), so only the dark half moves.
  const shadowColor = input.shadowColor ?? {
    // Black is the only value with headroom under a page that is already the
    // brand's deepest ink.
    dark: '0 0 0',
    // Paper page: the brand's own ink reads as a warm shadow, not a hard black.
    light: input.colors.dark.bgPrimary,
  }
  const typography = { ...DEFAULT_TYPOGRAPHY, ...input.typography }
  const layout = { ...DEFAULT_LAYOUT, ...input.layout }

  const buildTokens = (mode: BrandMode): BrandTokens => ({
    colors: input.colors[mode],
    calendarSwatches:
      input.calendarSwatches?.[mode] ?? DEFAULT_CALENDAR_SWATCHES[mode],
    effects: {
      ...defaultEffects(mode, shadowColor[mode]),
      ...input.effects?.[mode],
    },
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
    clientConsultResults:
      input.clientConsultResults ?? defaultClientConsultResultsCopy,
    clientConsultBooking:
      input.clientConsultBooking ?? defaultClientConsultBookingCopy,
    tokensByMode: {
      dark: buildTokens('dark'),
      light: buildTokens('light'),
    },
  }
}
