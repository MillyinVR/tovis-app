// lib/brand/brands/tovis.ts
import type { BrandConfig } from '../types'

const fontSans =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"'

export const tovisBrand: BrandConfig = {
  id: 'tovis',
  displayName: 'TOVIS',
  defaultMode: 'dark',
  assets: {
    mark: {
      src: '/brand/tovis/mark.png',
      alt: 'TOVIS mark',
    },
    wordmark: {
      text: 'TOVIS',
    },
  },
  tokensByMode: {
    dark: {
      colors: {
        // Base Dark
        bgPrimary: '15 17 21', // #0F1115
        bgSecondary: '20 22 28', // #14161C

        // Text
        textPrimary: '230 232 237', // Pearl Smoke-ish
        textSecondary: '182 187 196', // soft secondary

        // Glass layer base color (opacity applied in CSS)
        surfaceGlass: '230 232 237', // #E6E8ED

        // Accent (Gold)
        accentPrimary: '201 162 77', // #C9A24D
        accentPrimaryHover: '226 200 120', // #E2C878

        // Micro accent (Rose Quartz)
        microAccent: '207 166 160', // #CFA6A0
      },
      effects: {
        glassBlurPx: 20,
        glassOpacity: 0.08,
        shadowColor: '0 0 0', // you can tint later, keep clean now
        radiusAppIconPx: 28,
        radiusCardPx: 20,
      },
      typography: {
        fontSans,
        letterSpacingCaps: '0.08em',
      },
    },

    // Light mode exists for accessibility; keep it calmer.
    light: {
      colors: {
        bgPrimary: '245 246 248',
        bgSecondary: '236 238 242',
        textPrimary: '15 17 21',
        textSecondary: '60 65 74',
        surfaceGlass: '255 255 255',
        accentPrimary: '201 162 77',
        accentPrimaryHover: '226 200 120',
        microAccent: '207 166 160',
      },
      effects: {
        glassBlurPx: 18,
        glassOpacity: 0.10,
        shadowColor: '0 0 0',
        radiusAppIconPx: 28,
        radiusCardPx: 20,
      },
      typography: {
        fontSans,
        letterSpacingCaps: '0.08em',
      },
    },
  },
}
