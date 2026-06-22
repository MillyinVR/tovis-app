// lib/brand/brands/tovis.ts
//
// The canonical TOVIS brand — the reference implementation of a BrandConfig.
// Built through createBrandConfig: provide the palette + logo + contact, and
// the factory fills in effects, typography (the Grotesk trio), layout, and the
// shared pro-calendar copy. White-label brands follow the same shape — see
// lib/brand/brands/_template.ts and docs/design/white-label-runbook.md.
import type { BrandConfig } from '../types'
import { createBrandConfig } from '../createBrand'
import { TOVIS_EYE_SVG } from '../eyeSvg'

export const tovisBrand: BrandConfig = createBrandConfig({
  id: 'tovis',
  displayName: 'TOVIS',
  tagline: 'The New Age of Self Care',
  defaultMode: 'dark',

  assets: {
    mark: { src: '/brand/tovis/mark.svg', alt: 'tovis', svg: TOVIS_EYE_SVG },
    wordmark: { text: 'tovis' },
  },

  contact: {
    businessName: 'Tovis Technology',
    supportEmail: 'Support@tovis.app',
    location: 'Encinitas, CA',
  },

  // Peacock Plume palette — full color sets for both modes.
  colors: {
    dark: {
      // ink canvas (brand sheet: --bg / --bg-section / --surface)
      bgPrimary: '10 20 19', // #0A1413
      bgSecondary: '14 26 24', // #0E1A18
      bgSurface: '17 32 30', // #11201E

      textPrimary: '242 239 231', // #F2EFE7 paper
      textSecondary: '199 210 207', // #C7D2CF
      textMuted: '143 163 158', // #8FA39E

      surfaceGlass: '242 239 231', // paper-tinted glass

      accentPrimary: '21 201 168', // #15C9A8 Plume Teal
      accentPrimaryHover: '47 224 190', // brighter teal glow
      microAccent: '242 180 62', // #F2B43E Plume Gold ("goodness")
      onAccent: '10 20 19', // ink reads on teal/gold

      colorAcid: '107 75 230', // #6B4BE6 Iris Violet (pop / saves)
      colorFern: '14 142 137', // #0E8E89 Deep Emerald (success)
      colorEmber: '255 61 110', // #FF3D6E Like coral (danger / like)
      colorAmber: '242 180 62', // #F2B43E Gold (pending / attention)
    },
    light: {
      // paper canvas; chrome flips, media stays dark
      bgPrimary: '243 240 231', // #F3F0E7
      bgSecondary: '236 232 221', // #ECE8DD section band
      bgSurface: '255 255 255', // #FFFFFF elevated card

      textPrimary: '10 20 19', // #0A1413 ink
      textSecondary: '58 74 70', // #3A4A46
      textMuted: '98 115 110', // #62736E

      surfaceGlass: '10 20 19', // ink-tinted glass

      accentPrimary: '14 155 134', // #0E9B86 (deeper teal for contrast on paper)
      accentPrimaryHover: '11 122 107', // #0B7A6B accent-ink
      microAccent: '183 131 31', // #B7831F gold-ink (readable gold)
      onAccent: '255 255 255', // white reads on light-mode teal

      colorAcid: '91 60 214', // #5B3CD6 iris (light)
      colorFern: '11 111 102', // #0B6F66 emerald (light)
      colorEmber: '225 29 84', // #E11D54 like (light)
      colorAmber: '183 131 31', // #B7831F gold-ink (readable on paper — matches microAccent; drives warn/pending tones)
    },
  },
})
