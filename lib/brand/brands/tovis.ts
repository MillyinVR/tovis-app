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

      // Black, so a backdrop still darkens the ink canvas. At /70 over
      // bgPrimary this composites to rgb(3,6,6) — byte-identical to the
      // bg-black/70 that shipped before #922.
      scrim: '0 0 0',

      textPrimary: '242 239 231', // #F2EFE7 paper
      textSecondary: '199 210 207', // #C7D2CF
      textMuted: '143 163 158', // #8FA39E

      surfaceGlass: '242 239 231', // paper-tinted glass

      accentPrimary: '21 201 168', // #15C9A8 Plume Teal
      accentPrimaryHover: '47 224 190', // brighter teal glow
      microAccent: '242 180 62', // #F2B43E Plume Gold ("goodness")
      onAccent: '10 20 19', // ink reads on teal/gold

      colorAcid: '107 75 230', // #6B4BE6 Iris Violet (pop / saves)
      // 🔴 Was #0E8E89, which failed AA as TEXT on 4 of 6 dark readings —
      // including 3.75 inside its own `bg-toneSuccess/10` notice — and dark
      // is the DEFAULT mode. It went unseen because every palette check in
      // the cleanup register was light-only. All 66 of this token's text
      // sites are at FULL opacity, so its raw value governs the failing role.
      colorFern: '10 164 158', // #0AA49E Deep Emerald (success) — worst reading 4.76
      colorEmber: '255 61 110', // #FF3D6E Like coral (danger / like)
      colorAmber: '242 180 62', // #F2B43E Gold (pending / attention)
    },
    light: {
      // paper canvas; chrome flips, media stays dark
      bgPrimary: '243 240 231', // #F3F0E7
      bgSecondary: '236 232 221', // #ECE8DD section band
      bgSurface: '255 255 255', // #FFFFFF elevated card

      // Paper, matching bgPrimary — light mode's backdrop must stay light or
      // the ink-coloured labels sitting on the glass panel go invisible again
      // (#922 measured 12 of 12 failing WCAG AA before that fix).
      scrim: '243 240 231', // #F3F0E7

      textPrimary: '10 20 19', // #0A1413 ink
      textSecondary: '58 74 70', // #3A4A46
      textMuted: '98 115 110', // #62736E

      surfaceGlass: '10 20 19', // ink-tinted glass

      // #0E9B86 was not deep enough: 3.05:1 on paper, 2.83:1 on the section
      // band, and — the part nobody had measured — only 3.47:1 for the WHITE
      // `onAccent` sitting on top of it, so every filled accent button in light
      // mode was below AA both ways round.
      //
      // ⚠️ The hover has to move WITH it. Any base dark enough to clear 4.5:1 on
      // paper lands on top of the old hover (#0B7A6B), which would leave the two
      // states ~1.0 apart — an invisible hover is a worse bug than the one being
      // fixed. This pair keeps a 1.47 step, against today's 1.51.
      accentPrimary: '10 115 99', // #0A7363 — paper 5.06, band 4.71, white-on 5.76
      accentPrimaryHover: '8 87 75', // #08574B — paper 7.45, white-on 8.48
      // The BRAND gold (→ --micro-accent / --gold). Was #B7831F, 2.93 on paper
      // and below AA on all 42 TEXT sites (the governing role — 371 of 373
      // tone-token text sites across the app run at full opacity). ✅ Raised
      // [approved by Tori 2026-08-16], same rule #935 used for `colorAmber`:
      // nearest AA-compliant shade preserving this token's own hue (39°).
      // Unlike colorAmber's fix (which jumped to full saturation), this one
      // holds saturation within 1.5% of the original — Δhue 0.1°, ΔL -14.9% —
      // so the two golds stay visually distinct rather than merely
      // numerically unequal. Worst reading 4.92 (inside its own /10 notice on
      // the section band); the `/15` tint `ProPortfolioTile` actually uses is
      // 4.60. Also checked (new, `microaccentcandidates.mjs`): the ONE site
      // that paints microAccent as a SOLID fill with real text on it —
      // `SearchMapClient`'s filter-count badge (`bg-gold text-onAccent`, a 9px
      // digit) — 6.92, clear.
      microAccent: '117 84 21', // #755415 gold-ink — paper 6.07, band notice 4.92
      onAccent: '255 255 255', // white reads on light-mode teal

      colorAcid: '91 60 214', // #5B3CD6 iris (light)
      // 🔴 Was #0B6F66: 5.30 on paper but 4.32 inside its own notice on the
      // section band. Measure the PATTERN, not the token on a bare surface.
      colorFern: '13 104 96', // #0D6860 emerald (light) — worst reading 4.71
      // 🔴 Both were below AA as TEXT, which is the role they mostly play. The
      // role count (rolecount.mjs, on 72def5a7) found ember painting 238 text
      // sites against 277 fills and borders, and the gold 135 against 203 — and
      // 371 of those 373 text sites are at FULL opacity, while the fills are
      // `/10` and the borders `/20`–`/50`. So the token's own value is the
      // governing number for exactly the role that was failing.
      //
      // ⚠️ Measure the PATTERN, not the token on paper. The app's canonical
      // notice is `bg-toneX/10 text-toneX`, and in light mode that tint LIGHTENS
      // the box: ember read 4.09 on paper but 3.52 inside its own notice, across
      // 62 call sites in 46 files. Both values below clear 4.5:1 on paper, on
      // the section band, on a card AND inside the tint on all of them.
      //
      // ⚠️ `--like` is `var(--color-ember)`, so the ♥ moves with this. On the
      // looks feed that is invisible — `(main)/looks/page.tsx` pins the subtree
      // `data-mode="dark"` — but the hearts on `/professionals/[id]` do darken
      // in light mode. They are icons, so they owe 3:1, which both values clear.
      colorEmber: '180 23 67', // #B41743 like (light) — paper 5.86, notice 4.96
      // 🔴 `colorAmber` and `microAccent` carried the same triplet but are
      // SEPARATE tokens: this one drives --tone-warn / --tone-pending / --amber,
      // microAccent drives --micro-accent / --gold. They are split here on
      // purpose — both are now raised, to DIFFERENT values (see microAccent's
      // own comment above), so they stay visually distinct. This one is the
      // most saturated amber at their shared hue (39°) that still clears AA
      // inside its own tint.
      colorAmber: '130 84 0', // #825400 status amber (light) — paper 5.73, notice 4.97
    },
  },
})
