// lib/brand/types.ts

export type BrandId = string // 'tovis' | 'salon-xyz' | 'school-abc' | ...

export type BrandMode = 'dark' | 'light'

export type RgbTriplet = `${number} ${number} ${number}`

export type BrandTokens = {
  colors: {
    // ── Background layers ─────────────────────────────────────────
    bgPrimary: RgbTriplet // darkest page bg → --bg-primary / --ink
    bgSecondary: RgbTriplet // elevated surface → --bg-secondary / --ink-2
    bgSurface: RgbTriplet // card / inner surface → --bg-surface / --ink-3

    // ── Text layers ───────────────────────────────────────────────
    textPrimary: RgbTriplet // primary readable text → --text-primary / --paper
    textSecondary: RgbTriplet // dimmed text → --text-secondary / --paper-dim
    textMuted: RgbTriplet // very muted / placeholder → --text-muted / --paper-mute

    // ── Glass surface ─────────────────────────────────────────────
    surfaceGlass: RgbTriplet // used with opacity in CSS → --surface-glass

    // ── Accent ───────────────────────────────────────────────────
    accentPrimary: RgbTriplet // brand signature → --accent-primary / --terra
    accentPrimaryHover: RgbTriplet // hover/glow state → --accent-primary-hover / --terra-glow
    microAccent: RgbTriplet // warm highlight → --micro-accent

    // ── Brand palette ────────────────────────────────────────────
    colorAcid: RgbTriplet // yellow-green CTAs / approvals → --color-acid / --acid
    colorFern: RgbTriplet // success / completed → --color-fern / --fern
    colorEmber: RgbTriplet // danger / cancelled / error → --color-ember / --ember
    colorAmber: RgbTriplet // pending / review / warm attention → --color-amber / --amber / --tone-pending
  }

  effects: {
    // ── Glass ─────────────────────────────────────────────────────
    glassBlurPx: number // 16–24 recommended
    glassOpacity: number // 0.06–0.12 recommended

    // ── Shadows ───────────────────────────────────────────────────
    shadowColor: RgbTriplet

    // ── Radii ─────────────────────────────────────────────────────
    radiusAppIconPx: number
    radiusCardPx: number
    radiusPanelPx: number
    radiusSheetPx: number
    radiusInnerPx: number
    radiusPillPx: number
  }

  typography: {
    fontSans: string // UI / body text → --font-sans
    fontDisplay: string // editorial headlines → --font-display
    fontMono: string // data, labels, caps → --font-mono
    letterSpacingCaps: string // caps labels → --ls-caps
    letterSpacingTight: string // editorial/display tightening → --ls-tight
  }

  layout: {
    pageMaxWidthPx: number // app content max width → --page-max-width
    mobileShellWidthPx: number // mobile shell / profile width → --mobile-shell-width
  }
}

export type BrandAssets = {
  mark: {
    // Keep it simple now: PNG path. Later swap to SVG path with same key.
    src: string
    alt: string
  }

  wordmark: {
    text: string // until you have an SVG wordmark
  }
}

export type BrandContact = {
  businessName: string // "Tovis Technology"
  supportEmail: string // "Support@tovis.app"
  location?: string // "Encinitas, CA"
}

export type BrandConfig = {
  id: BrandId
  displayName: string // "TOVIS" — used anywhere the brand name appears in UI
  tagline?: string // "A New Age of Self Care"
  defaultMode: BrandMode
  tokensByMode: Record<BrandMode, BrandTokens>
  assets: BrandAssets
  contact: BrandContact
}