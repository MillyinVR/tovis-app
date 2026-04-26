// lib/brand/brands/tovis.ts
import type { BrandConfig } from '../types'

// Inter Tight loaded via next/font into --font-body
const fontSans =
  'var(--font-body), "Inter Tight", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

// Fraunces loaded via next/font into --font-display-face
const fontDisplay =
  'var(--font-display-face), "Fraunces", Georgia, "Times New Roman", serif'

// JetBrains Mono loaded via next/font into --font-mono-face
const fontMono =
  'var(--font-mono-face), "JetBrains Mono", ui-monospace, "Cascadia Code", "Fira Code", monospace'

export const tovisBrand: BrandConfig = {
  id: 'tovis',
  displayName: 'TOVIS',
  tagline: 'A New Age of Self Care',
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

  contact: {
    businessName: 'Tovis Technology',
    supportEmail: 'Support@tovis.app',
    location: 'Encinitas, CA',
  },

  tokensByMode: {
    dark: {
      colors: {
        bgPrimary: '10 9 7', // Ink #0A0907
        bgSecondary: '20 17 14', // Ink-2 #14110E
        bgSurface: '30 26 21', // Ink-3 #1E1A15

        textPrimary: '244 239 231', // Paper #F4EFE7
        textSecondary: '205 198 187', // Paper-dim #CDC6BB
        textMuted: '122 117 105', // Paper-mute #7A7569

        surfaceGlass: '244 239 231', // Paper-tinted glass on dark

        accentPrimary: '224 90 40', // Terra #E05A28
        accentPrimaryHover: '255 106 54', // Terra-glow #FF6A36
        microAccent: '232 221 212', // Linen #E8DDD4

        colorAcid: '212 255 58', // Acid #D4FF3A
        colorFern: '98 168 122', // Fern #62A87A
        colorEmber: '255 61 78', // Ember #FF3D4E
        colorAmber: '240 168 48', // Amber / pending #F0A830
      },

      effects: {
        glassBlurPx: 20,
        glassOpacity: 0.09,
        shadowColor: '10 9 7',

        radiusAppIconPx: 28,
        radiusCardPx: 14,
        radiusPanelPx: 18,
        radiusSheetPx: 24,
        radiusInnerPx: 8,
        radiusPillPx: 999,
      },

      typography: {
        fontSans,
        fontDisplay,
        fontMono,
        letterSpacingCaps: '0.08em',
        letterSpacingTight: '-0.03em',
      },

      layout: {
        pageMaxWidthPx: 960,
        mobileShellWidthPx: 430,
      },
    },

    light: {
      colors: {
        bgPrimary: '244 239 231', // Paper #F4EFE7
        bgSecondary: '255 255 255', // White
        bgSurface: '250 247 244', // Warm white

        textPrimary: '10 9 7', // Ink #0A0907
        textSecondary: '122 117 105', // Paper-mute #7A7569
        textMuted: '154 148 140', // Very muted

        surfaceGlass: '10 9 7', // Ink-tinted glass on light bg

        accentPrimary: '224 90 40', // Terra #E05A28
        accentPrimaryHover: '255 106 54', // Terra-glow #FF6A36
        microAccent: '154 123 92', // Driftwood #9A7B5C

        colorAcid: '180 200 0', // Acid — darkened for legibility on light
        colorFern: '68 130 90', // Fern — darkened for light
        colorEmber: '210 40 55', // Ember — darkened for light
        colorAmber: '240 168 48', // Amber / pending #F0A830
      },

      effects: {
        glassBlurPx: 18,
        glassOpacity: 0.07,
        shadowColor: '30 22 18',

        radiusAppIconPx: 28,
        radiusCardPx: 14,
        radiusPanelPx: 18,
        radiusSheetPx: 24,
        radiusInnerPx: 8,
        radiusPillPx: 999,
      },

      typography: {
        fontSans,
        fontDisplay,
        fontMono,
        letterSpacingCaps: '0.08em',
        letterSpacingTight: '-0.03em',
      },

      layout: {
        pageMaxWidthPx: 960,
        mobileShellWidthPx: 430,
      },
    },
  },
}