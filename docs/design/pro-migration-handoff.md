# Pro Migration / Import — implementation handoff

Drop this into a new session to continue building the pro migration/import feature.
Design spec: `docs/design/pro-migration-import.md`. UI handoff:
`docs/design/pro-migration-import-ui-handoff.md`.

The feature lets a pro bring their **clients, service menu, and calendar** over from a
competitor app. It's merged to `main` **behind a feature flag** (`ENABLE_PRO_MIGRATION`,
unset in prod → flow hidden). Clients + Services are fully built; Calendar + Review are
UI-only mocks; quote-time price-grace resolution is not wired yet.

---

## 0. Run + verify locally (do this first)

- Code lives under `app/pro/migrate/`, `app/api/pro/migrate/`, `lib/migration/`,
  `lib/offerings/`, `lib/services/`.
- **Local dev DB** is the isolated `tovis-dev` Postgres on port 5434 (NOT prod). The
  worktree/checkout needs `.env.development.local` (gitignored) with:
  ```
  DATABASE_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev"
  DIRECT_URL="postgresql://postgres:postgres@localhost:5434/tovis_dev"
  ENABLE_PRO_MIGRATION=1
  ```
  Without `ENABLE_PRO_MIGRATION=1` the flow redirects/404s (that's the prod gate).
  `prisma.config.ts` refuses prod DB writes unless `ALLOW_PROD_DB=1`. NEVER run
  `prisma db push`/`migrate` against prod.
- Bring the DB up + seed if needed: `pnpm db:dev:up` then `pnpm db:dev:setup`.
- **Pro login:** `pro@tovis.app` / `password123`. NOTE: login matches by `emailHashV2`
  blind index; if the local DB was re-seeded with a different PII keyring, login 401s —
  re-hash the pro: compute `buildEmailLookupHashV2ForContactInput('pro@tovis.app')` from
  `@/lib/security/contactLookup` and update `User.emailHashV2`/`emailHashKeyVersion` +
  bcrypt `password` in the local DB.
- Dev server: the migration UI is gated under `/pro/migrate` (pro-auth + flag). Walk it at
  `/pro/migrate` → `/services` → `/clients` (real, working).
- **Gates before every push:** `npx tsc --noEmit -p tsconfig.json` (FULL — vitest does NOT
  typecheck; a latent `noUncheckedIndexedAccess` error slipped past vitest once),
  `npm run check:static-guards`, `npm test`. All currently green (3972 tests).

---

## 1. What's DONE (merged, behind the flag)

**Clients flow** — fully wired + DB-verified.
- Page `app/pro/migrate/clients/` (upload CSV → papaparse → column map → preview → commit).
- `lib/migration/clientImport.ts` (parse/normalize, reuses `lib/security/contactNormalization`).
- `lib/migration/clientImportServer.ts` — `previewClientImport` (NEW/EXISTING/MISSING_INFO,
  reuses the exact `buildClientProfileLookupOrConditions` predicate exported from
  `upsertProClient`) + `commitClientImport` (loops `upsertProClient` in a tx, **silent — no
  client invites**, best-effort with per-row results).
- Routes `app/api/pro/migrate/clients/{preview,commit}/route.ts`.

**Services flow** — fully wired + DB-verified.
- Page `app/pro/migrate/services/` (upload menu → matcher suggestions → dropdown map →
  raise-plan tuning → commit). Reuses `ServiceMapRow` + `RaisePlanSection` (its ramp config
  is lifted to commit via `onConfigChange`).
- `lib/migration/serviceMatch.ts` — matcher (exact/alias/fuzzy/token-containment,
  `CONFIDENT_SCORE=70`, alias table). 12 tests.
- `lib/migration/serviceImportServer.ts` — `previewServiceImport` (matches menu vs catalog) +
  `commitServiceImport` (creates offerings via `writeOffering`, attaches `OfferingPriceRamp`
  for below-min prices). Routes `app/api/pro/migrate/services/{preview,commit}/route.ts`.

**Price-grace foundation.**
- `OfferingPriceRamp` model (per offering+mode) + migration
  `prisma/migrations/20260617120000_add_offering_price_ramp`. `RaiseStepMode` enum (PCT/USD).
- `lib/migration/priceRamp.ts` — THE single source for the step formula, the 10%/10wk floor,
  `buildInitialRamp`, `advanceRamp` (catches up missed cron ticks), and `effectiveUnitPrice`
  (new clients → catalog min, existing → ramped price). 18 tests. The UI calculator delegates
  here (no duplicated formula).

**Single-source extractions** (the import reuses these; routes delegate, tests unchanged).
- `lib/offerings/writeOffering.ts` (location-ensure + offering create + DTO). Offerings route
  delegates; all 22 route tests pass.
- `lib/services/allowedServices.ts` — `loadAllowedServices(professionalId)` (license-gated
  catalog). allowed-services route delegates.

**Feature gate.** `app/pro/migrate/layout.tsx` + `lib/migration/featureFlag.ts` redirect/404
the whole flow unless `ENABLE_PRO_MIGRATION` is on. All four import endpoints check it too.

---

## 2. What's NEXT (in order)

### A. Quote integration — the deep/risky one. Do this as its own well-tested pass.
The grace ramps are stored but **nothing reads them yet**. Wire booking price reads through
`effectiveUnitPrice` from `lib/migration/priceRamp`:
- Find EVERY place a price is quoted/charged. Start at `createProBooking`'s
  `subtotalSnapshot` in `lib/booking/writeBoundary.ts`; also check availability/quote display
  paths (e.g. `app/.../booking/AvailabilityDrawer`, offering DTOs shown to clients).
- For an offering with an `OfferingPriceRamp` (per mode): **new client → `targetPrice`
  (catalog min); existing client → `currentPrice`**. "Existing" = the client has a booking
  with this pro created before `ramp.startedAt` (migrated clients qualify once their history
  is imported in step C).
- This touches the **shared booking pricing path** the waitlist/priority-offer work also
  uses — add focused tests and confirm nothing else shifts. `effectiveUnitPrice` already has
  unit tests; the integration needs its own.

### B. Ramp step job (cron)
A scheduled job that loads ramps where `completedAt IS NULL AND nextStepAt <= now`, calls
`advanceRamp`, and persists `currentPrice`/`nextStepAt`/`completedAt`. Follow the repo's cron
pattern (see existing crons / `vercel.json`). Index `OfferingPriceRamp(completedAt,nextStepAt)`
already exists for this query.

### C. Calendar page (still mock)
Wire `app/pro/migrate/calendar/`. iCal feed / Square-Acuity import → for each appointment:
future + service maps → real `Booking` (`source = IMPORTED` — needs a new `BookingSource`
enum value + migration); future + unmapped → `CalendarBlock`; past → client history (NOT a
booking). Reuse `createProBooking` (silent) / `tx.calendarBlock.create` /
`withLockedProfessionalTransaction`. Idempotency keyed on the source event UID.

### D. Review / go-live page (still mock)
Wire `app/pro/migrate/review/` to real summary counts + an atomic go-live commit.

### E. Pre-launch cleanup (before flipping the flag on in prod)
- Add a ProHeader nav entry (`app/pro/ProHeader.tsx` — `PRO_HEADER_ROUTE_TITLES` +
  optionally `PRO_HEADER_TABS`).
- Remove now-unused mocks: `mockClientsViewModel`, `mockServicesViewModel` in
  `app/pro/migrate/_mock.ts` and the unused view-model types in `_types.ts`
  (Calendar/Review still use their mocks until wired).
- Expand the canonical `Service` catalog + alias table (matcher confidence is low against the
  ~7-row seed; admin manages the catalog at `/api/admin/services`). "I draft, you refine."
- Per-source-app export instructions (currently generic).

---

## 3. Conventions / gotchas (the user cares about these)

- **Single source of truth, no duplicated logic.** Always reuse: `upsertProClient` (clients),
  `writeOffering` (offerings), `loadAllowedServices` (catalog), `createProBooking` (bookings),
  `priceRamp` (ramp math), `effectiveUnitPrice` (quote). Extract before duplicating.
- **No casts / no `as any`.** Use type guards + narrowing (see the `parse*Request` helpers).
- **Run FULL `tsc`**, not just vitest — vitest doesn't typecheck (repo uses
  `noUncheckedIndexedAccess`).
- **PII guard:** reads of `email`/`phone`/`firstName`/`lastName` need a same-line
  `// pii-plaintext-read-ok: <reason>` annotation (or route through `lib/security`).
- **Brand guard:** no hardcoded "Tovis" (even in comments); UI copy lives in
  `lib/brand/defaultMigrationCopy.ts`, brand name via the `wordmark` param.
- **Migrations:** local = `pnpm db:dev:push`; prod migration files generated via
  `prisma migrate diff --from-schema-datamodel <git show HEAD~1:prisma/schema.prisma> \
  --to-schema-datamodel prisma/schema.prisma --script`, written to a `prisma/migrations/<ts>_*`
  dir with a timestamp AFTER the latest existing one. Prod applies on deploy.
- **Imports never bundle server into client:** UI uses `import type` for server modules.

---

## 4. Key files

| Area | File |
|---|---|
| Matcher | `lib/migration/serviceMatch.ts` (+ `.test.ts`) |
| Ramp math | `lib/migration/priceRamp.ts` (+ `.test.ts`) |
| Client import | `lib/migration/clientImport.ts`, `clientImportServer.ts` (+ tests) |
| Service import | `lib/migration/serviceImportServer.ts` |
| Offering write | `lib/offerings/writeOffering.ts` |
| Catalog read | `lib/services/allowedServices.ts` |
| Feature flag | `lib/migration/featureFlag.ts`, `app/pro/migrate/layout.tsx` |
| Pages | `app/pro/migrate/{page,services,clients,calendar,review}` |
| Endpoints | `app/api/pro/migrate/{clients,services}/{preview,commit}` |
| Schema | `prisma/schema.prisma` (`OfferingPriceRamp`, `RaiseStepMode`) |
