# White-label runbook — onboarding a school / salon

Goal: stand up a new white-label brand from a **palette + logo + contact**, no
component edits. The brand system (`lib/brand/`) drives colors, fonts, logo,
metadata, favicon/OG, light/dark — everything routes through brand tokens, so
defining a brand re-skins the whole app for that tenant.

## What you need from the partner
1. **Name** (display name) + optional **tagline**.
2. **Logo** — an SVG mark (ideally) + the wordmark text.
3. **Contact** — business name, support email, optional location.
4. **Palette** — colors for **dark and light** mode (see token list below). If
   they only give brand colors, reuse TOVIS's neutral ramps and just swap the
   accent/brand hues.

## Steps

### 1. Create the brand file
Copy the template and edit it:

```
cp lib/brand/brands/_template.ts lib/brand/brands/<slug>.ts
```

`<slug>` must match the tenant's slug (see `docs/architecture/tenant-model.md`).
Fill in `id` (= slug), `displayName`, `tagline`, `assets`, `contact`, and the
`colors` (dark + light). The factory (`createBrandConfig`) fills in radii/glass,
the Grotesk fonts, layout, and all product copy automatically.

### 2. Add the logo asset
Drop the logo at `public/brand/<slug>/mark.svg` and point `assets.mark.src` at
it. To brand the **favicon, OG/social card, and iOS icon** too, also paste the
raw SVG markup into `assets.mark.svg` — otherwise those fall back to The Eye.

### 3. Register the brand
In `lib/brand/index.ts`, import and add it to `brandRegistry`:

```ts
import { exampleSchoolBrand } from './brands/example-school'

const brandRegistry: Record<BrandId, BrandConfig> = {
  tovis: tovisBrand,
  'example-school': exampleSchoolBrand,
}
```

Tenant-facing surfaces resolve the brand by slug via
`getBrandForTenantContext` — an unregistered slug safely falls back to TOVIS.

### 4. Verify
```
npm run typecheck && npm run build
```
Then load the tenant host and toggle light/dark (Settings → Appearance).

## Color tokens (RGB triplets, "R G B")
Per mode (`dark` and `light`):

| token | role |
|---|---|
| `bgPrimary` / `bgSecondary` / `bgSurface` | page bg / section band / elevated card |
| `textPrimary` / `textSecondary` / `textMuted` | primary / secondary / muted text |
| `surfaceGlass` | glass tint (usually = textPrimary so it inverts per mode) |
| `accentPrimary` / `accentPrimaryHover` | brand action color + hover |
| `microAccent` | secondary warm accent (TOVIS = gold) |
| `onAccent` | text/icon color that sits on `accentPrimary` (legibility) |
| `colorAcid` / `colorFern` / `colorEmber` / `colorAmber` | pop·saves / success / danger / warning |

Tips: ensure `textPrimary` is legible on `bgPrimary` and `onAccent` is legible
on `accentPrimary` in **both** modes. In light mode, pick an accent dark enough
to read as small text (TOVIS uses a deeper teal in light).

## Not yet automated (future)
- **Fonts**: a brand inherits the Grotesk trio. Custom per-tenant fonts need
  `next/font` faces wired into `--font-*` in `app/layout.tsx`.
- **Static `app/icon.svg` favicon** is The Eye by default; per-tenant favicon
  currently relies on the OG/apple-icon routes (which do read `assets.mark.svg`).
- The animated `TovisEye` / loader mark is TOVIS-specific; white-label brands
  use their static `mark` everywhere.
