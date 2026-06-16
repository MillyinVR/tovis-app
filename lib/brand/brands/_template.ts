// lib/brand/brands/_template.ts
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │ WHITE-LABEL BRAND TEMPLATE — copy this file to <slug>.ts and edit.   │
// │ This file is intentionally NOT registered (see lib/brand/index.ts).  │
// │ Full steps: docs/design/white-label-runbook.md                       │
// └─────────────────────────────────────────────────────────────────────┘
//
// To onboard a school/salon you only provide: name + tagline, logo + wordmark,
// contact, and the color palette (dark + light). The factory fills in the rest
// (radii/glass, the Grotesk fonts, layout, and all product copy).
//
// Colors are RGB triplets: "R G B" (space-separated, 0–255), e.g. "99 102 241".
import type { BrandConfig } from '../types'
import { createBrandConfig } from '../createBrand'

export const exampleSchoolBrand: BrandConfig = createBrandConfig({
  id: 'example-school', // must match the tenant slug
  displayName: 'Example Academy',
  tagline: 'Where talent takes the stage',
  defaultMode: 'dark',

  assets: {
    // Drop the logo at public/brand/example-school/mark.svg
    mark: { src: '/brand/example-school/mark.svg', alt: 'Example Academy' },
    // `svg: '<svg …>'` (raw markup) is optional — add it so the favicon / OG
    // card / iOS icon use this logo instead of falling back to The Eye.
    wordmark: { text: 'Example Academy' },
  },

  contact: {
    businessName: 'Example Academy, Inc.',
    supportEmail: 'support@example-academy.edu',
    location: 'Somewhere, USA',
  },

  // The palette. Keep dark legible on the dark bg, light on the light bg.
  colors: {
    dark: {
      bgPrimary: '13 17 28',
      bgSecondary: '18 23 38',
      bgSurface: '24 30 48',

      textPrimary: '237 240 248',
      textSecondary: '190 198 214',
      textMuted: '128 138 158',

      surfaceGlass: '237 240 248',

      accentPrimary: '99 102 241', // indigo
      accentPrimaryHover: '129 132 255',
      microAccent: '245 197 66', // gold
      onAccent: '13 17 28', // reads on the accent

      colorAcid: '99 102 241', // pop / saves
      colorFern: '52 168 120', // success
      colorEmber: '244 63 94', // danger
      colorAmber: '245 197 66', // warning
    },
    light: {
      bgPrimary: '244 246 251',
      bgSecondary: '236 239 247',
      bgSurface: '255 255 255',

      textPrimary: '13 17 28',
      textSecondary: '55 65 88',
      textMuted: '100 112 134',

      surfaceGlass: '13 17 28',

      accentPrimary: '79 70 229',
      accentPrimaryHover: '67 56 202',
      microAccent: '180 140 20',
      onAccent: '255 255 255',

      colorAcid: '79 70 229',
      colorFern: '22 130 90',
      colorEmber: '220 38 70',
      colorAmber: '202 150 30',
    },
  },
})
