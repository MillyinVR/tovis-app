// lib/brand/types.ts
export type BrandId = string // 'tovis' | 'salon-xyz' | 'school-abc' | ...

export type BrandMode = 'dark' | 'light'

export type RgbTriplet = `${number} ${number} ${number}`

export type BrandTokens = {
  colors: {
    // ── Background layers (dark → light) ──────────────────────────
    bgPrimary: RgbTriplet   // darkest page bg         → --bg-primary  / --ink
    bgSecondary: RgbTriplet // elevated surface         → --bg-secondary / --ink-2
    bgSurface: RgbTriplet   // card / inner surface     → --bg-surface   / --ink-3

    // ── Text layers (most → least prominent) ──────────────────────
    textPrimary: RgbTriplet   // primary readable text  → --text-primary  / --paper
    textSecondary: RgbTriplet // dimmed text             → --text-secondary / --paper-dim
    textMuted: RgbTriplet     // very muted / placeholder→ --text-muted    / --paper-mute

    // ── Glass surface ──────────────────────────────────────────────
    surfaceGlass: RgbTriplet // used with opacity in CSS → --surface-glass

    // ── Accent ────────────────────────────────────────────────────
    accentPrimary: RgbTriplet      // brand signature    → --accent-primary / --terra
    accentPrimaryHover: RgbTriplet // hover/glow state   → --accent-primary-hover / --terra-glow
    microAccent: RgbTriplet        // warm highlight      → --micro-accent

    // ── Brand palette ─────────────────────────────────────────────
    colorAcid: RgbTriplet   // yellow-green CTAs / approvals → --color-acid / --acid
    colorFern: RgbTriplet   // nature green / success        → --color-fern / --fern
    colorEmber: RgbTriplet  // alert red / danger            → --color-ember / --ember
  }
  effects: {
    glassBlurPx: number    // 16–24 recommended
    glassOpacity: number   // 0.06–0.12 recommended
    shadowColor: RgbTriplet
    radiusAppIconPx: number
    radiusCardPx: number
  }
  typography: {
    fontSans: string  // UI / body text
    fontMono: string  // data, labels, caps
    letterSpacingCaps: string
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
  businessName: string   // "Tovis Technology"
  supportEmail: string   // "Support@tovis.app"
  location?: string      // "Encinitas, CA"
}

export type BrandConfig = {
  id: BrandId
  displayName: string    // "TOVIS" — used anywhere the brand name appears in UI
  tagline?: string       // "A New Age of Self Care"
  defaultMode: BrandMode
  tokensByMode: Record<BrandMode, BrandTokens>
  assets: BrandAssets
  contact: BrandContact
}
