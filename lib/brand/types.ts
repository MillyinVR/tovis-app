// lib/brand/types.ts
export type BrandId = string // 'tovis' | 'salon-xyz' | 'school-abc' | ...

export type BrandMode = 'dark' | 'light'

export type RgbTriplet = `${number} ${number} ${number}`

export type BrandTokens = {
  colors: {
    bgPrimary: RgbTriplet
    bgSecondary: RgbTriplet
    textPrimary: RgbTriplet
    textSecondary: RgbTriplet
    surfaceGlass: RgbTriplet // used with opacity in CSS
    accentPrimary: RgbTriplet
    accentPrimaryHover: RgbTriplet
    microAccent: RgbTriplet // Rose Quartz
  }
  effects: {
    glassBlurPx: number // 16–24 recommended
    glassOpacity: number // 0.06–0.12 recommended
    shadowColor: RgbTriplet // tinted shadow base
    radiusAppIconPx: number
    radiusCardPx: number
  }
  typography: {
    // Apple-adjacent system stack; you can override later per brand
    fontSans: string
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
