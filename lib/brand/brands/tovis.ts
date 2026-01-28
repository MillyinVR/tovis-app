// lib/brand/brands/tovis.ts
import type { BrandConfig } from '../types'

const fontSans =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"'

export const tovisBrand: BrandConfig = {
  id: 'tovis',
  displayName: 'TOVIS',
  defaultMode: 'dark',
  assets: {
    mark: { src: '/brand/tovis/mark.png', alt: 'TOVIS mark' },
    wordmark: { text: 'TOVIS' },
  },
  tokensByMode: {
    dark: {
      colors: {
        // richer, slightly cooler base so gold pops
        bgPrimary: '10 12 16', // deep graphite
        bgSecondary: '16 19 25', // elevated surface

        // text tuned to feel less “white on black”
        textPrimary: '236 238 242',
        textSecondary: '170 176 188',

        // glass "ink" (used with opacity)
        surfaceGlass: '255 255 255',

        // gold that reads “luxury” instead of “mustard”
        accentPrimary: '212 173 88',
        accentPrimaryHover: '235 206 138',

        // rose quartz stays subtle
        microAccent: '208 168 164',
      },
      effects: {
        glassBlurPx: 24,
        glassOpacity: 0.10,

        // slightly warm shadow tint looks expensive
        shadowColor: '0 0 0',
        radiusAppIconPx: 28,
        radiusCardPx: 22,
      },
      typography: {
        fontSans,
        letterSpacingCaps: '0.08em',
      },
    },

    light: {
      colors: {
        bgPrimary: '246 247 249',
        bgSecondary: '237 240 244',
        textPrimary: '12 14 18',
        textSecondary: '70 76 86',
        surfaceGlass: '255 255 255',
        accentPrimary: '212 173 88',
        accentPrimaryHover: '235 206 138',
        microAccent: '208 168 164',
      },
      effects: {
        glassBlurPx: 20,
        glassOpacity: 0.12,
        shadowColor: '0 0 0',
        radiusAppIconPx: 28,
        radiusCardPx: 22,
      },
      typography: {
        fontSans,
        letterSpacingCaps: '0.08em',
      },
    },
  },
}
