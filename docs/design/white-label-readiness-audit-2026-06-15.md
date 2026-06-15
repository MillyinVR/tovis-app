# White-label readiness audit — 2026-06-15

Goal: make UI upgrades easy and white-labeling (schools/salons) a low-touch
process — hand over a color palette + logo and complete it with minimal input.

## Verdict

The **architecture is genuinely strong** — better than most apps at this stage.
A real brand system already exists (`lib/brand/`): per-brand tokens (colors,
effects, typography, layout), assets, contact, and a large copy namespace, all
tenant-resolved through `getBrandForTenantContext()` and applied as CSS vars via
`BrandProvider`. Emails/SMS already resolve the brand name. The literal-"TOVIS"
guard (`check-no-hardcoded-brand-strings`) is nearly burned down (2 entries left).

The gaps are in **what the brand config doesn't yet drive**: a pile of hardcoded
colors that bypass the tokens, fonts locked in the root layout, missing logo
asset + favicon/PWA/OG generation, and a few hardcoded copy strings. None are
architectural rewrites — they're "route the last mile through the system."

## What's already solid (keep)

- `lib/brand/types.ts` + `brands/tovis.ts` — full BrandConfig (tokens per
  light/dark mode, assets, contact, proCalendar copy).
- `lib/brand/utils.ts` `toCssVars()` → CSS variables; `tailwind.config.js`
  semantic tokens (`accentPrimary`, `bgPrimary`, `terra`, `acid`, …).
- `getBrandForTenantContext()` correctly refuses host/env fallback for
  white-label tenants (no cross-tenant brand leakage).
- All CSS files (`brand.css`, `proCalendar.css`, etc.) are 100% token-driven.
- Wordmark text, metadata title/description, support page contact, email/SMS
  brand name — all brand-resolved.

## Gaps, prioritized

### P0 — blocks a clean palette swap

1. **Hardcoded colors in components** (~61 hex + ~172 rgba literals across ~21
   `.tsx`; CSS is clean). Worst offenders:
   - `app/config/clientNav.ts:24-29` `CENTER_BUTTON` — hardcoded `#E05A28`
     (accent), `#F4EFE7`, `#ffffff`, `#0A0907`. Drives the always-visible footer.
   - `app/_components/ClientSessionFooter/ClientSessionFooter.tsx:26,45,46`
   - `app/_components/GuestSessionFooter/GuestSessionFooter.tsx:36,53,54`
   - `app/pro/profile/ReviewsPanel.tsx` (~15 hex, also assumes light bg `#fff/#eee`)
   - `app/pro/reviews/page.tsx` (~12 hex), `app/client/ClientMeDashboard.tsx`
     (`border-[#3a2418]`, `bg-[rgba(20,12,9,0.9)]`), booking/looks drawers use
     `rgba(244,239,231,…)` = surface-glass-as-literal.
   - Landing/about/faq buttons: `text-[#F2EDE7]` (3 spots).
   - Fix = replace with tokens (`accentPrimary`, `surfaceGlass`,
     `rgb(var(--surface-glass)/…)`, `toneSuccess`, etc.).

2. **Logo image is referenced but doesn't exist.** `brand.assets.mark.src =
   '/brand/tovis/mark.png'` but there is **no `public/brand/` dir and no
   mark.png anywhere** → `app/client/settings/page.tsx:35` renders a 404 image.
   Need to commit the asset(s) and a per-tenant path convention.

### P1 — needed for "hand over logo + palette and done"

3. **Fonts hardcoded in `app/layout.tsx:20-37`** (Inter Tight / Fraunces /
   JetBrains Mono via `next/font/google`). Brand typography only references the
   vars the layout sets, so a tenant can't change fonts without editing layout.

4. **Favicon static** (`app/favicon.ico`, one file). No `app/icon.tsx` /
   `app/apple-icon.tsx`, no per-brand generation.

5. **No PWA manifest** (`app/manifest.ts`), **no OG/Twitter image**
   (`opengraph-image.tsx`), **no `themeColor`/`appleWebApp`** metadata.

6. **Email/SMS polish**: bodies resolve brand name, but no `FromName`,
   no `Reply-To`, no support-email footer, no logo/colors. Twilio Verify SMS
   uses Twilio's managed template (no app-level brand name).

### P2 — copy/cosmetic

7. Hardcoded copy: landing hero subtitle (`app/page.tsx`), login tagline
   "No spam. Just bookings." (`LoginClient.tsx`), `proCalendar.pageHero.title:
   'tovis'` (intentional per-brand, just document it).
8. Wordmark is text-only (`AuthShell.tsx:38`) — add optional logo-image field.
9. `.tovis-` CSS class prefix — cosmetic only.

## Suggested approach

- **Phase A (foundation):** add a wordmark image field; commit logo asset +
  `public/brand/<slug>/` convention; drive fonts + favicon + manifest + OG +
  themeColor from brand config; email FromName/Reply-To/footer.
- **Phase B (sweep):** replace all P0 hardcoded colors with tokens; extend the
  `check-no-hardcoded-brand-strings` guard to also flag hardcoded hex/rgba in
  `app/`+`lib/` `.tsx` (outside `lib/brand/`) so regressions can't creep back.
- **Phase C (onboarding):** a `brands/<slug>.ts` template + short runbook so a
  new tenant = palette triplets + logo + contact, nothing else.

After A+B, white-labeling a tenant = drop a BrandConfig (palette + logo +
contact) and register it; no component edits.
