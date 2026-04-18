// lib/brand/brands/tovis.ts
import type { BrandConfig } from '../types'

// DM Sans loaded via next/font into --font-body
const fontSans =
  'var(--font-body), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial'

export const tovisBrand: BrandConfig = {
  id: 'tovis',
  displayName: 'TOVIS',
  tagline: 'A New Age of Self Care',
  defaultMode: 'dark',
  assets: {
    mark: { src: '/brand/tovis/mark.png', alt: 'TOVIS mark' },
    wordmark: { text: 'TOVIS' },
  },
  contact: {
    businessName: 'Tovis Technology',
    supportEmail: 'Support@tovis.app',
    location: 'Encinitas, CA',
  },
  tokensByMode: {
    // Light mode is primary — Parchment bg, white cards, Espresso text, Terra accent
    light: {
      colors: {
        // Parchment — main page background
        bgPrimary: '247 243 238',
        // White — card/surface background
        bgSecondary: '255 255 255',

        // Espresso — primary text
        textPrimary: '30 22 18',
        // Driftwood — secondary/muted text
        textSecondary: '154 123 92',

        // Espresso-tinted glass (dark frosting on light bg)
        surfaceGlass: '30 22 18',

        // Terra — signature accent
        accentPrimary: '196 103 58',
        accentPrimaryHover: '208 122 77',

        // Driftwood as micro-accent
        microAccent: '154 123 92',
      },
      effects: {
        glassBlurPx: 18,
        glassOpacity: 0.07,
        shadowColor: '30 22 18',
        radiusAppIconPx: 28,
        radiusCardPx: 14,
      },
      typography: {
        fontSans,
        letterSpacingCaps: '0.08em',
      },
    },

    // Dark mode — optional, available for toggle
    dark: {
      colors: {
        // Espresso — warm dark brown
        bgPrimary: '30 22 18',
        // Bark — elevated surface
        bgSecondary: '61 46 39',

        // Parchment — warm off-white text
        textPrimary: '247 243 238',
        // Driftwood — muted warm secondary text
        textSecondary: '154 123 92',

        // Parchment-tinted glass
        surfaceGlass: '247 243 238',

        // Terra accent
        accentPrimary: '196 103 58',
        accentPrimaryHover: '208 122 77',

        // Linen micro-accent
        microAccent: '232 221 212',
      },
      effects: {
        glassBlurPx: 20,
        glassOpacity: 0.09,
        shadowColor: '30 22 18',
        radiusAppIconPx: 28,
        radiusCardPx: 14,
      },
      typography: {
        fontSans,
        letterSpacingCaps: '0.08em',
      },
    },
  },
}
