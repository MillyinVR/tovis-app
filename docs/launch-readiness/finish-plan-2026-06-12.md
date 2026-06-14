# TOVIS finish-plan — from `bce4e7` to launch

> Authored 2026-06-12 against verified HEAD `bce4e7`. Supersedes ad-hoc gap lists. This is a
> **tiered, ramp-shaped** plan: do the cheap high-leverage work first, gate each ramp stage, and
> **park the speculative white-label/scale machinery until real demand pulls it.**
>
> Guiding principles (the corrections from the 2026-06-12 audit):
> 1. **Staging is the hidden critical path** — one environment unblocks 5 launch-gate boxes.
> 2. **Stop saying "100k day one."** Provision for 100k; ramp DAU over launch weeks. Gate each
>    ramp stage, not a big bang.
> 3. **Sell white-label before building it.** Isolation is done + proven; the presentation/onboarding
>    machinery is deferred until a partner signs.
> 4. **Reconcile the load target with the harness.** Targets are per-route p95/p99, not "10k concurrent."
> 5. **Guard the guards.** A guard whose baseline grows is worse than none. Baselines stay zero/shrinking.
> 6. **No new mega-files.** Don't mirror the 13k-line booking boundary four times; verify scatter first.

## Status snapshot (verified)

- **Done & proven:** type discipline (0 escapes, guard), booking lifecycle SSoT, PII AEAD + HMAC,
  session-state realtime, tenant **isolation** (asymmetric filter + guard + real test), 9 structural
  guards green, chaos + load *suites* exist, Sentry wired.
- **Remaining = scale-proof + a few features + ops decisions.** None are "the code is wrong."
- **~70% of the combined plan.** Engineering/privacy/lifecycle layers 80–95%; scale-proof /
  white-label-completion / rollout-ops layers 15–40%.

## Tier overview

| Tier | Goal | Gates it closes | Blockers |
|---|---|---|---|
| **0 — Foundation** | A real staging environment | unblocks deployed load/E2E/chaos/health/dashboards | none — do first |
| **1 — Private-beta gate** | Safely onboard ~5 trusted pros | hot-path perf, deployed proof, rollback drill, ops decisions | Tier 0 |
| **2 — Public-ramp gate** | Open to public in staged ramp | UploadSession, prod APM, rollout flags, tenant attribution | Tier 1 |
| **3 — White-label (on-demand)** | Onboard a paying partner | per-tenant sender/domain/payments/onboarding | **PARKED** until a partner signs |

---

## Tier 0 — Foundation (do first, ~1 sprint)

### T0.1 — Stand up a staging environment  ⭐ critical path
**Why:** every deployed-proof gate depends on this; today no staging exists (all env points at
`localhost` or prod `tovis.app`).
**Build:**
- A dedicated Vercel deployment (separate project or a long-lived `staging` branch/preview) bound to
  a staging domain (e.g. `staging.tovis.app`).
- A throwaway staging Postgres (Supabase staging project or branch) seeded with **ample** availability
  + bookings (richer than the dev seed — enough distinct slots for the load harness's 450-hold runs).
- **Test-mode** Stripe (`sk_test_…`), Postmark (test stream / sandbox), Twilio (test creds) so load
  runs cost nothing and send nothing real.
- Populate `.env.staging.local` with `STAGING_BASE_URL`, the seeded `LOAD_TEST_PROFESSIONAL_ID` /
  `LOAD_TEST_SERVICE_ID` / booking ids, a matching `STRIPE_WEBHOOK_SECRET`, and a documented way to
  mint `LOAD_TEST_CLIENT_COOKIE` / `LOAD_TEST_PRO_COOKIE` (login needs an `Origin` header — CSRF guard).
**Acceptance:**
- `pnpm test:load:availability` against `STAGING_BASE_URL=https://staging.tovis.app` returns 200s.
- A `docs/launch-readiness/staging-setup.md` runbook exists so the env is reproducible.
- No production resource is touched by any load/chaos run.
**Effort:** M (½–1 sprint, mostly DevOps config). **Owner decision needed:** Supabase staging branch vs separate project.

---

## Tier 1 — Private-beta gate (~5 trusted pros)

These gate a *small real-user* beta. Most are cheap; several are decisions, not code.

### T1.1 — EXPLAIN + index/N+1 audit of hot read paths  (no staging needed — start immediately)
**Why:** today's local load showed availability saturating at 100 rps with connection exhaustion;
Phase 6 is ~35% done. Cheapest high-value work available.
**Do:** `EXPLAIN ANALYZE` on availability bootstrap, day-slots, search/nearby, hold-create. Add any
missing indexes; kill N+1 includes on Pro dashboard + session pages. Document in `docs/performance/`.
Files: `lib/availability/{core,data}`, `lib/search/pros.ts`, `lib/discovery/nearbyPros.ts`.
**Acceptance:** each hot query has a reviewed plan; no seq-scan on a hot path; findings recorded.
**Effort:** S.

### T1.2 — Reconcile + run the modeled load against staging
**Why:** the harness tops out at 100 rps; the "10k concurrent" headline is unverifiable. Replace it
with the per-route p95/p99 targets from commit `603f4a0`.
**Do:** finalize per-route targets in `load-test-plan.md`; ensure the harness mixes endpoints at the
modeled ratio; run `pnpm test:load:launch` against staging; record per-route p95/p99 in
`load-test-plan.md` + `deployed-smoke-proof.md`. Delete the "10k concurrent" phrasing or define exactly
what generates it.
**Acceptance:** every hot path has a recorded deployed p95/p99 vs target; bottlenecks ticketed.
**Depends:** T0.1, T1.1. **Effort:** M.

### T1.3 — Deployed staging browser E2E (full booking lifecycle)
**Do:** run the existing `tests/e2e/booking-lifecycle.spec.ts` against staging; record SHA/env/output
in `test-proof.md`. **Acceptance:** green against staging, recorded. **Depends:** T0.1. **Effort:** S.

### T1.4 — Deployed chaos run + alert routing decision
**Do:** run `tests/chaos/*` patterns against staging where safe; **decide Sentry→Slack** (currently
blocked on plan upgrade): either upgrade the Sentry plan, or wire an alternative (Sentry webhook → a
tiny relay → Slack). Prove one real app-generated alert reaches a human channel.
**Acceptance:** one alert demonstrably pages a human; chaos results recorded. **Depends:** T0.1. **Effort:** M.

### T1.5 — Rate-limit keying review
**Why:** local hold-create load showed the limiter shedding everything to 429 from one identity — right
for abuse, wrong if it blunt-keys by IP (NAT/office bursts get throttled).
**Do:** confirm limiter keys per-identity (user/session), not raw IP, on auth + booking + hold paths;
add a burst-tolerance test. **Acceptance:** legitimate burst from one identity isn't over-throttled;
abuse still shed. **Effort:** S.

### T1.6 — Rollback drill via runtime flags
**Why:** `lib/runtimeFlags.ts` exists (boolean kill switches) but no rollback has been exercised.
**Do:** in staging, flip a kill switch (e.g. `bookingCreationEnabled=false`), confirm graceful
degradation, restore; document in a `rollback-drill.md`. **Acceptance:** a kill switch demonstrably
disables a feature without a deploy, recorded. **Depends:** T0.1. **Effort:** S.

### T1.7 — Tier-3 PII decision (date + owner)  🧑‍⚖️ decision
**Why:** free-text (consultation notes, allergy/sensitivity, messages, bio) is still plaintext and
"deferred indefinitely" — health-adjacent on a beauty platform.
**Do:** EITHER encrypt the two worst fields (allergy + consultation notes) reusing `lib/security/crypto/aead.ts`,
OR formally risk-accept with a date + owner in `docs/security/`, mirroring the SHA-256→HMAC decision.
Confirm all four are redacted from logs regardless. **Acceptance:** no open-ended defer; a dated,
owned decision exists. **Effort:** S (accept) / M (encrypt).

### T1.8 — Launch-shape decision: ramp, not big bang  🧑‍⚖️ decision
**Do:** formally adopt the staged rollout ladder (5 → 25 → 100 → public) from `go-no-go.md` as THE
launch model; restate the "100k day one" goal as "provision for 100k, ramp DAU." If a hard big-bang is
truly wanted, secure ≥1 backup on-call human first (the single-owner risk is the realest launch risk).
**Acceptance:** launch model + on-call ownership are written and signed. **Effort:** S (decision).

### T1.9 — Sign the private-beta go/no-go
**Do:** with T1.1–T1.8 done, complete and **sign** `go-no-go.md` for the private-beta stage only.
**Acceptance:** signed gate with proof entries dated within 7 days. **Depends:** T1.1–T1.8.

**Tier-1 Definition of Done:** 5 trusted pros can run real bookings on prod; hot paths have measured
p99; one alert reaches a human; a kill switch is proven; PII + launch-shape decisions are signed.

---

## Tier 2 — Public-ramp gate

Needed before opening past the controlled beta. Build only after Tier 1 proves the foundation.

### T2.1 — UploadSession / upload-token binding  (Phase 4 — the one unbuilt launch feature)
**Build** (per the Phase 4 spec already drafted): `UploadSession` model (`tenantId`, `bookingId?`,
`professionalId?`, `clientId?`, `surface`, `storageBucket`, `storagePath`, `contentType`, `maxBytes`,
`checksumSha256?`, `status`, `expiresAt`, `consumedAt`) + `UploadSurface`/`UploadSessionStatus` enums.
Flow: `POST /api/pro/uploads` creates the session + returns the signed URL; the media-attach route
takes `{ uploadSessionId, caption }`, validates the session (owner/booking/phase/expiry/checksum),
creates the `MediaAsset`, and consumes the session. **Reuse** `lib/media/renderUrls.ts` +
`authorization.ts` + `publicShareGuard.ts`; do not duplicate signed-URL logic. Add an orphan/stale-session
cleanup job. **First step for the implementer:** read the current media-attach route to ground
storage-path validation (don't let the client supply the path as authority).
**Acceptance:** wrong pro/booking/phase/expired session all fail; consumed session can't double-attach;
storage path is never client-authoritative. **Effort:** L.

### T2.2 — Tenant columns on `MediaAsset` + `Notification` (+ backfill)
**Why:** isolation is enforced at discovery surfaces, but these rows carry no tenant id — needed for
per-tenant analytics, billing attribution, and per-tenant GDPR export/delete. Cheap now, painful on
live data later. **Do:** expand-contract migration adding `proTenantId`/`tenantId` (nullable → backfill
from the owning pro/booking → NOT NULL + index). **Acceptance:** both models carry an indexed tenant id;
backfill idempotent. **Effort:** M.

### T2.3 — Production APM + per-route p99 dashboards
**Do:** pick ONE (Sentry Performance + tracing is already half-wired — cheapest; Datadog if you want
unified APM later). Add OTel/tracing to route handlers + the `writeBoundary` functions; dashboards for
booking success, availability/finalize p99, aftercare delivery, webhook lag; tag with `tenantId`.
**Acceptance:** prod p99 per hot route is visible on a live dashboard linked from `go-no-go.md`.
**Effort:** M.

### T2.4 — Percentage / cohort rollout flags
**Why:** the ramp ladder needs more than boolean kill switches. **Do:** extend `lib/runtimeFlags.ts`
with percentage + cohort (tenant/region) evaluation. **Acceptance:** a feature can be enabled for N% or
a named cohort; deterministic per-user bucketing. **Effort:** M.

### T2.5 — Remaining CI guards — **only where scatter is real**
**Do:** before writing each guard, grep to confirm the domain is actually scattered. Likely worth it:
`api-response` guard (enforce `app/api/_utils/responses.ts` `jsonOk/jsonFail`). Probably worth it:
`auth-boundary` guard. Verify-first: `duplicate-utilities`. **Skip** payment/notification *write-boundary*
guards unless T2.6 proves those domains are scattered. **Acceptance:** each new guard has a zero/near-zero
baseline. **Effort:** S each.

### T2.6 — Domain write-boundaries — **verify scatter, then maybe**
**Do:** grep the actual mutation sites for notifications / payments / auth (the Stripe webhook is
already centralized + atomic — it may need nothing). Only introduce a boundary where mutations are
genuinely scattered, and use the `writeBoundary` + `contract` + `queries` split from day one — **no new
13k-line files.** **Acceptance:** a written finding on scatter-per-domain; boundaries added only where
justified. **Effort:** S (audit) + L (per boundary, if needed).

### T2.7 — Scale infra as the numbers demand
**Do, gated on T1.2/T2.3 findings:** confirm Supabase pooler in front of all prod reads/writes; enable
a read replica + route hot reads via a `$replica` selector in `lib/prisma.ts` **only if** read pressure
shows it. Job-queue (Inngest) migration **only if** cron jobs prove unreliable under load — otherwise
parked. **Acceptance:** pooler confirmed; replica/queue added only with evidence. **Effort:** M–L.

**Tier-2 Definition of Done:** UploadSession enforced; prod p99 visible; ramp flags live; tenant
attribution on media/notifications; public ramp can proceed stage-by-stage with measured gates.

---

## Tier 3 — White-label (PARKED until a partner signs) 🅿️

Isolation is done + proven, so you can onboard a partner with a manual `Tenant` row in ~a day. **Do not
build the machinery below speculatively.** Each item lists its *trigger*.

| Item | Trigger to un-park |
|---|---|
| Per-tenant sender identity (Postmark stream + Twilio sender) | partner needs branded email/SMS |
| Custom-domain provisioning (Vercel domain API) + `Tenant.customDomain` CRUD | partner wants their own domain |
| DB-backed `Brand` / per-tenant theming UI | >a handful of partners (file-based config suffices below that) |
| Per-tenant Stripe Connect modes (`Tenant.stripeMode` PLATFORM/TENANT_OWNED) | partner wants their own payout account |
| `UserTenantMembership` model | a user must belong to multiple tenants |
| Self-serve partner onboarding | manual onboarding becomes the bottleneck |
| Tenant columns on remaining models (Review, etc.) | a concrete per-tenant query/report needs it |

**Before the first partner goes live, regardless:** run the isolation test matrix (already exists,
extend if needed) — tenant A can't see tenant B's pros/bookings/media/tokens; root sees all.

---

## Explicitly NOT doing now (scope discipline)

- "10k concurrent" as a literal target (replaced by per-route p95/p99).
- Datadog (unless Sentry Performance proves insufficient).
- Inngest job migration (unless cron proves unreliable under load).
- DB-backed brand config / self-serve onboarding (file-based until partner count forces it).
- Tier-3 free-text encryption beyond allergy + consultation notes (rest risk-accepted with a date).
- Four new write-boundary mega-files (audit scatter first; split-file pattern only).
- Mobile push (polling is sufficient for launch).

## Decisions — RESOLVED 2026-06-13 (owner: Tori Morales)

Chosen for **long-term correctness** (isolate blast radius · learn confidence rather than declare it ·
encrypt while cheap · one stack well, not two halfway):

1. **Staging DB → separate Supabase project** (not a branch). Hard isolation guarantee: load/chaos/bad
   migration can never reach prod data or keyrings; mirrors prod topology so "passes on staging" means
   something. (T0.1)
2. **Sentry→Slack → DONE.** Sentry is on a paid plan; wire alert routing directly (no relay). This is now
   an implementation task, not a decision. (T1.4)
3. **Tier-3 PII → encrypt allergy + consultation notes now; date-stamped risk-accept the rest.** Health-
   adjacent data, cheapest to encrypt while volume is small, reuses the proven AEAD pattern, displayed
   in-context (not searched) so encryption is clean. Messages/bio stay risk-accepted with a written review
   date. Scoped in `docs/security/ticket-encrypt-tier3-health-notes.md`. (T1.7)
4. **Launch shape → ramp ladder** (5 → 25 → 100 → public), not a big bang. Correctness is learned per
   stage; lowest-variance with a solo operator; builds the ops muscle enterprise handoff needs.
   **Action item:** secure ≥1 backup on-call human before the public stages. (T1.8)
5. **APM → Sentry Performance now; Datadog only if outgrown.** Sentry is already paid + wired; one
   well-instrumented stack beats two. Add OTel tracing on route handlers + `writeBoundary`, tagged with
   `tenantId`. **Decision rule:** revisit Datadog only when Sentry APM provably can't express a needed
   signal (deep infra metrics, or per-tenant cohort dashboards becoming central to ops). (T2.3)

## Immediate next 2 weeks (start here)

1. **T1.1** EXPLAIN + index audit — no dependencies, start today.
2. **T0.1** staging environment — the unlock; kick off in parallel.
3. **T1.5** rate-limit keying review — cheap, no dependencies.
4. Make decisions #1–#4 above so Tier 1 isn't blocked.

Then T1.2/T1.3/T1.4 (deployed proof) land as soon as staging is up, and the private-beta gate (T1.9)
becomes signable.
