# Session Handoff — Launch Roadmap Execution (2026-06-10)

> Context file for continuing the launch roadmap in a fresh session.
> Read this first, then `docs/audits/plan-audit-2026-06-09.md` (the roadmap),
> `docs/architecture/tenant-model.md` (tenant contract), and
> `docs/architecture/canonical-modules.md` (where logic lives).

## Non-negotiable rules (user-stated)

1. **No `as any`, no casts.** Type escapes live only in `lib/typed/` (enforced
   by `check:no-type-escape`). Fix indexed-access findings with runtime guards
   (`requireDefined` in `lib/guards.ts`), never assertions.
2. **No duplicate logic.** When you find a copy-pasted helper, extract it
   (see `lib/initials.ts`, `app/client/_components/bookingDisplay.ts`).
3. **Prisma is the single source of truth** for data shape; mutations go
   through write boundaries (`lib/booking/writeBoundary.ts` etc.).
4. **Ready for 100k users day 1** — per-route targets live in
   `docs/launch-readiness/traffic-model.md`; new polling/fan-out features must
   be load-bounded by design.
5. The user (Tori) is a **solo operator** — single-owner risk is formally
   accepted for private beta (RISK-001, 2026-06-09); a named backup remains a
   public-rollout blocker.

## Verification loop (run before every commit)

```bash
pnpm typecheck && pnpm check:static-guards && pnpm test
# DB-level work additionally:
pnpm test:integration   # needs docker test DB; files run sequentially
```

9 static guards run in CI (`static-guards.yml` → `check:static-guards`).
Guard baselines (`tools/baselines/*.txt`) may only shrink, never grow.

## Where things stand

### Done and merged to main (sprints 0–4 + WS-5)
- Sprint 0: CI guard script restored, admin password hardened, solo-operator
  risk recorded, Sentry→Slack synthetic alert proven.
- Sprint 1–2: Pro session refresh (state endpoint + `useSessionState` polling
  via session-segment layout); `lib/typed`; `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch` enabled
  (`exactOptionalPropertyTypes` deferred, ~283 errors, plan in
  canonical-modules.md).
- Sprint 3–4: Tenant foundation — `Tenant` model (root slug `tovis-root`),
  expand migration, `backfill:tenant-foundation` (proven on test DB),
  `lib/tenant/` visibility helpers + resolver, 10-test DB isolation matrix,
  `check-tenant-aware-discovery` guard (baseline **0**).
- WS-5 enforcement: visibility filters wired into all 5 discovery surfaces
  (`searchPros` takes a required `TenantContext`; admin/viral use explicit
  `platformCrossTenantProVisibilityFilter`); booking write boundary stamps
  `proTenantId`/`clientHomeTenantId` at create via
  `lib/tenant/bookingAttribution.ts`.

### In flight
- **PR #54 (OPEN — merge it first):** `check-no-hardcoded-brand-strings`
  guard (22-entry baseline = WS-6 copy worklist), `getBrandForTenantContext`
  (exact-registry lookup; NEVER let `NEXT_PUBLIC_BRAND`/host fallback decide a
  white-label brand — Codex review caught this, fixed in d8d0e50),
  `docs/launch-readiness/traffic-model.md`.

## Remaining work, in priority order

### Engineering (this track)
1. **Brand copy burn-down** — migrate the 22 baselined hardcoded TOVIS
   strings (`tools/baselines/no-hardcoded-brand-strings.txt`) onto
   `getBrandForTenantContext`: auth emails (`lib/auth/emailVerification.ts`,
   `passwordReset.ts`), claim invites
   (`lib/clientActions/createClientClaimInviteDelivery.ts`), notification
   `BRAND_PREFIX` (`lib/notifications/delivery/renderNotificationContent.ts`),
   SMS policy (`lib/transactionalSmsPolicy.ts`), calendar PRODID. Callers must
   thread a `TenantContext` (root for now where no request exists).
2. **Custom-domain middleware** — wire `resolveTenantByHost` into
   middleware/root layout so white-label domains resolve a tenant context +
   brand end-to-end.
3. **Contract migration** — NOT NULL on the 5 tenant columns + drop
   `NfcCard.salonSlug`. **Gated on Tori running
   `pnpm backfill:tenant-foundation -- --write` against the launch
   environment** (zero remaining NULLs required; script fails loudly).
4. Later (Q3/WS-9): per-tenant `BrandConfig`s, white-label client signup
   (then layer client `homeTenantId` into `resolveTenantContextForRequest` —
   currently host-only), partner beta, Stripe PLATFORM_OWNED first.
5. Deferred by plan: Inngest migration, identity-field encryption,
   `exactOptionalPropertyTypes`.

### Ops track (Tori's — gates private beta, not engineering-blocked)
- Staging run of `pnpm verify:launch-ops`, recorded in go-no-go +
  `docs/deployment-checklist.md` evidence fields (must cite traffic-model.md).
- Launch-env reruns: privacy phase-1 items (3 unchecked in
  `docs/privacy/phase-1-remaining-work.md`) + tenant backfill.
- Sentry: runbook-link-in-alert-message + formal ack timing (5-min UI tasks);
  live dashboard sections + thresholds (`docs/runbooks/booking-funnel.md`).
- Then complete go-no-go sign-off tables → private beta (tovis-root only;
  white-label work does NOT gate it).

## Gotchas / open issues

- **Browser E2E fails on main** (pre-existing, `tests/e2e/auth.setup.ts:33`,
  all 28 tests skip). A chip session was fixing it. Don't treat a red E2E on
  a PR as caused by that PR — check main first.
- **Stacked PRs burned us once:** merging a stack top-down stranded 17
  commits on a closed branch (recovered via PR #53). Merge bottom-up, or
  prefer single PRs onto main now that the stack is flat.
- **Test DB loses raw-SQL artifacts:** `pnpm db:test:push` doesn't apply
  `prisma/migrations/20260522000000_add_booking_overlap_exclusion/migration.sql`
  (btree_gist exclusion constraint). After recreating the container, psql-apply
  that file or the overlap integration test fails. (Chip task exists.)
- Integration tests run **sequentially** (`fileParallelism: false`) because
  suites do global `deleteMany({})` on the shared DB. Don't seed
  (`pnpm seed:test`) before `pnpm test:integration` — seeded LookPost/
  ServicePermission rows break the suites' cleanup; recycle via
  `db:test:down && db:test:up && db:test:push` instead.
- Another concurrent session/user sometimes commits to the same branch —
  check `git status`/HEAD before committing (see auto-memory).
- The Vercel bot posts deploy-status PR comments that look like reviews —
  noise, ignore. Codex bot reviews ARE worth reading (caught 2 real bugs).

## Key module map

| Thing | Where |
|---|---|
| Tenant contract + helpers | `docs/architecture/tenant-model.md`, `lib/tenant/` |
| Brand resolution (tenant-aware) | `lib/brand/forTenant.ts` (exact lookup only) |
| Session polling | `lib/proSession/sessionState.ts`, `useSessionState.ts`, session layout |
| Booking mutations | `lib/booking/writeBoundary.ts` (13k lines; 3 create sites stamp tenant attribution) |
| Guards + baselines | `tools/check-*.mjs`, `tools/baselines/` |
| Launch ops status | `docs/launch-readiness/` (go-no-go.md is the gate) |
