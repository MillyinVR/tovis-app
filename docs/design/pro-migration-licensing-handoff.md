# Pro migration — licensing scope-of-practice handoff (Phase 2)

Pick this up in a new session to seed **what each license type can legally offer, per state**, so a pro only sees/manages services their license permits in their location. **Back-end only — clients never see license/state/board terms, just the service name + its display category.**

---

## 0. First: merge Phase 1 (#216) and sync

- **PR [#216] (`feature/migration-license-types`)** adds the specialty `ProfessionType` values this work depends on. If it's merged, `git checkout main && git pull`. If still open, merge it first (CI was green except a slow `availability-performance`/`Browser E2E` — runner backlog, not a failure).
- Phase 2 code references `LASH_TECHNICIAN` / `HAIR_BRAIDER` / `PERMANENT_MAKEUP_ARTIST`, so it MUST be based on a `main` that contains #216 or it won't typecheck.
- **Dev env:** Docker Desktop must be running → `pnpm db:dev:up` (or `db:dev:start`) then `pnpm db:dev:push` (applies schema incl. the new enum values) and `pnpm db:dev:seed`. Pro login `pro@tovis.app` / `password123`. Flag: `ENABLE_PRO_MIGRATION=1` in `.env.development.local`.
- Gates before every push: `npx tsc --noEmit -p tsconfig.json`, `npm run check:static-guards`, `npm test`. (Pre-existing untracked `lib/booking/discoveryFee.*` trips the brand guard with "1 new violation" — NOT ours; ignore.)

## 1. The data source

The user compiled **"Barbering & Cosmetology Licensing — Scope of Practice Across All 50 States" (June 2026)** — board structure, license types, and the services each license may provide, for all 50 states. **Ask the user to re-paste it at the start of the new session** (it's their reference; it wasn't committed to keep the repo lean). The actionable distillation is in §4–§6 below, so you can largely work from this handoff and use the doc to verify per-state specifics.

## 2. The model (already exists)

`ServicePermission { serviceId, professionType (enum), stateCode String? }` gates the catalog. `loadAllowedServices(professionalId)` returns services with a matching permission for the pro's `(professionType, licenseState)` where `stateCode = the pro's state OR null`.

- **`stateCode = null` ⇒ allowed in all 50 states** (one row). Use for the baseline.
- It's an **allow-list** (a row = permitted; there's no "deny" row). So "allowed everywhere except X" is expressed by NOT using a null row and instead adding per-state rows for the allowed states.
- Internal only — never rendered to clients.

## 3. License-name → our `ProfessionType` (the doc's names vary wildly; collapse them)

| Our type | Board names that map to it |
|---|---|
| `COSMETOLOGIST` | Cosmetologist, Master Cosmetologist (GA), Beauty Operator–Cosmetologist (HI), Registered Hairdresser & Cosmetician (CT), Hairdresser/Cosmetician (RI), Cosmetology/Appearance Enhancement (NY), merged Barbering+Cosmetology (IA), Cosmetologist/Barber combined (UT), Cosmetologist-Hairstylist (NJ) |
| `BARBER` | Barber, Master Barber, Barber II / Class 2 (AL), Registered Barber, Master Hair Care Specialist (SC), Barber-Stylist (ID), Non-Chemical Barber, Barbering Art.28 (NY) |
| `ESTHETICIAN` | Esthetician, Aesthetician, Facialist, Skin/Facial Care Specialist (FL/NJ), Master/Advanced Esthetician (advanced scope but same type), Esthetics/Appearance Enhancement (NY) |
| `MANICURIST` | Manicurist, Nail Technician, Nail Specialist (FL), Nail Technologist (IA), Manicurist-Pedicurist (NM), Nail Specialty (NY) |
| `HAIRSTYLIST` | Hairstylist, Hair Designer, Hairdresser (AK — hair-only), Hair Design (OR), Limited Hairstylist (MD), Hair Stylist |
| `ELECTROLOGIST` | Electrologist, Electrology |
| `MAKEUP_ARTIST` | Makeup Artist (NV/OK certs) |
| `LASH_TECHNICIAN` | Eyelash Technician (AZ/CT/MN), Eyelash Specialist (TN/TX), Eyelash Artistry permit (KY), Limited Eyelash Extension (MD), Lash & Brow Technician (UT), AK lash via hairdresser+esth |
| `HAIR_BRAIDER` | Hair Braider, Natural Hair Stylist, Natural Hair Culturist (MI), Natural Hair Care Specialist (NC), Alternative Hair Design (LA) |
| `PERMANENT_MAKEUP_ARTIST` | Permanent Cosmetic Tattooer (VA), Permanent Cosmetic Coloring (AK) — most states treat PMU as tattoo/body-art OUTSIDE these boards |

## 4. Nationwide BASELINE (stateCode = null) — the ~95% that's consistent

Map each profession to scope buckets, expand to the canonical services in those buckets (catalog from PR #215, now 30 services):

- **COSMETOLOGIST** → hair (Balayage, Partial/Full Highlights, All-Over Color, Toner/Gloss, Root Touch-Up, Haircut & Style, Men's Cut, Blowout, Keratin, Extension Installation) + skin (Classic Facial, Brazilian Wax) + lashes (Classic/Volume Lash, Lash Fill, Lash Lift) + brows (Brow Lamination, Brow Wax & Shape) + nails (Gel/Classic Manicure, Gel Pedicure, Acrylic Full Set, Dip Powder, Gel X Full Set) + makeup (Soft Glam).
- **BARBER** → hair cut/style/color/shave (Haircut & Style, Men's Cut, Blowout, All-Over Color, Toner/Gloss). (Master barber adds chemical; baseline can include color.)
- **ESTHETICIAN** → skin (Classic Facial, Brazilian Wax) + lashes + brows + makeup (Soft Glam). NO hair/nails, NO laser.
- **HAIRSTYLIST** → hair only (same hair list as cosmetologist, minus skin/nails/lash).
- **MANICURIST** → nails only.
- **MAKEUP_ARTIST** → Soft Glam Makeup, Bridal Makeup.
- **ELECTROLOGIST** → electrolysis (NO catalog service yet — either add "Electrolysis" service in Phase 2 or skip).
- **LASH_TECHNICIAN** → lashes only (Classic/Volume Lash, Lash Fill, Lash Lift).
- **HAIR_BRAIDER** → braiding (NEW service "Box Braids" — add in Phase 2).
- **PERMANENT_MAKEUP_ARTIST** → "Microblading" (NEW service — add in Phase 2).

## 5. Per-state EXCEPTIONS to encode (from the doc)

- **Lash extensions carved out to a separate license** (so in these states, do NOT grant lash services to ESTHETICIAN/COSMETOLOGIST — grant only to LASH_TECHNICIAN): **AZ, CT, KY, MD, MN, OK, TN, TX, UT**. (Implementation: don't put lash services in the null baseline for esth/cosmo; instead add per-state rows for the ~41 states that DO allow them, OR keep baseline and add deny-awareness. Simplest correct approach: lash services get per-state allow rows for esth/cosmo EXCEPT those 9 states, and a null row for LASH_TECHNICIAN.)
- **AZ barber** scope includes skin care/facials + hair removal (broader than typical) → grant Classic Facial/wax to BARBER in AZ.
- **Microblading/PMU**: only meaningful where the board issues it (VA, AK). Elsewhere it's tattoo/body-art outside these boards → PERMANENT_MAKEUP_ARTIST may have no bookable cosmetology service in most states. Grant Microblading to PERMANENT_MAKEUP_ARTIST nationwide-null is defensible (the license itself implies authorization wherever held), OR restrict. Confirm with user.
- **Laser hair removal**: medical/advanced everywhere → NOT in our catalog; skip entirely.
- **Threading**: widely exempt/unregulated → either allow broadly under esthetician or leave out (no "Threading" service in catalog currently).
- **"unclear / not addressed / verify" flags** in the doc: do NOT grant — leave those service×state×license combos unpermitted.

## 6. Phase 2 build plan

1. **New canonical services** (seed + `SERVICE_ALIASES`, like PR #215): `Microblading` (new category "Permanent Makeup"), `Box Braids` (new "Braiding" category under Hair). Aliases: microblading→['microblading','micro blading','permanent brows','pmu brows','ombre brows','powder brows']; box braids→['box braids','braids','knotless braids','feed in braids','cornrows'].
2. **Structured mapping file** `lib/migration/licenseScope.ts` (or JSON): `{ profession → baseline service-name list }` + `{ exceptions: [{ state, profession, addServices?, removeServices? }] }`. This is the reviewable artifact — keep it data, not logic.
3. **Importer** `lib/migration/licensePermissionsImport.ts` + a prod-safe script (model after existing backfill scripts under `scripts/`, env-guarded): resolve service names → ids, expand baseline (null) + exceptions (per-state) → `prisma.servicePermission` upserts (dedupe on `{serviceId, professionType, stateCode}` like the seed's `ensurePermission`). Include a **dry-run mode** + a report of unmatched service names / professions with no services.
4. **Tests**: importer expands baseline + applies a lash-carve-out exception correctly; unmatched names reported not silently dropped (mirror `calendarImportServer.test.ts` style with mocked prisma).
5. **Seed**: optionally call the baseline expansion from `prisma/seed.cjs` so dev/fresh installs get realistic permissions. Prod catalog + permissions are admin-applied.
6. Verify live against dev DB (Docker up): seed → log in as a pro of each license type → confirm the migrate `/services` import only offers in-scope services. (See `pro-migration-handoff.md` §0 for the verify recipe; the calendar verify walk in this arc is the template.)

## 7. Status of the whole pro-migration arc (all merged to main unless noted)

A quote-ramp #204 · B ramp-cron #205 · C1 IMPORTED+importMode #206 · C2 calendar import #207 · C3a feed-URL #208 · D review/go-live #209 · E cleanup #210 · block-fallback #211 · snapping #213 · C3b resync #212 · resync-reconcile #214 · catalog 7→30 #215 · **license types #216 (merge first)**. `ENABLE_PRO_MIGRATION` still OFF in prod. Also pending the user: confirm catalog **min prices** (PR #215's `docs/design/canonical-catalog-expansion.md`) before prod rollout; Square/Acuity OAuth = Phase 2 (needs their dev credentials).
