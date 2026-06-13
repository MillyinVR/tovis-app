# Local load proof — 2026-06-12

> **Scope & status.** This is a **LOCAL, partial** load proof produced on a single developer
> machine. It is **NOT** the deployed-staging proof required by the go/no-go gate
> (`go-no-go.md`, `load-test-plan.md`). It validates that the hottest read path and the
> rate-limit shedding behave correctly under moderate concurrency, and it characterizes where a
> single local instance saturates. Deployed-staging numbers (pooled DB, read replica, CDN, edge
> rate-limiting) will differ and still must be recorded against a real staging environment.

## Environment

| Field | Value |
|---|---|
| Commit | `bce24e7` (branch `main`) |
| App | `next build` + `next start` (production build, Next.js 16.2.9) — **not** `next dev` |
| Database | Local Postgres `postgis/postgis:16-3.4`, container `tovis-test-postgres`, `localhost:5433/tovis_test` |
| Topology | **Single app instance, single local Postgres. No Supabase pooler, no read replica, no CDN, no edge rate-limiting.** |
| Target | `http://localhost:3000` (`STAGING_BASE_URL`) |
| Test data | `pnpm db:test:seed` defaults — 1 pro (`cmqakdkuw0003po6rfe28j8nn`), services, 3 clients, **0 bookings** |
| Auth | Fresh session cookies minted via `POST /api/auth/login` (`client@tovis.app` / `pro@tovis.app`, seed password). Login requires an `Origin` header (CSRF guard) — confirmed working. |
| Harness | `tests/load/*` via `pnpm test:load:*`, `LOAD_TEST_ENVIRONMENT=local-prod-build` |
| Note on "10k" | The suite's `launch` profile is **staged RPS (10 → 50 → 100 rps)**, not 10,000 literal concurrent users. The "100k users / ~10k concurrent" target remains a deployed-infra concern. |

## Results

### 1. Availability bootstrap — read path, no auth — `LOAD_TEST_PROFILE=launch` — ✅ (with local saturation point)

`GET /api/availability/bootstrap?professionalId=…&serviceId=…&days=14&includeOtherPros=1`

| Stage | Requests | Success (200) | Real failures | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| 10-rps | 600 | 600 | 0 | ~clean | ~clean | ~clean |
| 50-rps | 3000 | 3000 | 0 | 74.2 ms | 83.2 ms | **91.0 ms** |
| 100-rps | 6000 | 5811 | **189 (3.15%)** `NETWORK` | 79.1 ms | 206.4 ms | **3061 ms** |

**Read of it:** the endpoint holds **p99 < 100 ms through 50 rps with zero failures**. At 100 rps a
single local instance hits connection/socket limits: p50 stays low (~79 ms) but the tail blows out
(p99 ~3 s) and 3.15% of connections fail at the network layer (`NETWORK`, not app errors). This is a
**local single-instance/single-Postgres saturation artifact**, not a code defect — production runs
behind the Supabase pooler + (planned) read replica, which is exactly the capacity this local box
lacks. The saturation point should be re-measured on staging before crediting/discrediting the
p99-<500ms-at-launch acceptance criterion.

### 2. Hold create — write path, client cookie — `LOAD_TEST_PROFILE=baseline`, `LOAD_TEST_ALLOW_SLOT_REUSE=true` — ✅

`POST` hold creation. Seed provides only 12 open slots, so distinct-slot mode is impossible at this
volume; ran in slot-reuse mode to apply pressure.

| Stage | Requests | 201 created | 429 rate-limited (expected) | Real failures | p99 |
|---|---|---|---|---|---|
| 5-rps | 150 | 12 | 138 | 0 | 137 ms |
| 10-rps | 300 | 0 | 300 | 0 | 96.6 ms |

**Read of it:** **zero real failures.** A single client identity hammering the hold endpoint is
**throttled to clean 429s by the rate limiter** (fast, p99 < 140 ms), with the unthrottled few
creating holds (201). This proves rate-limit shedding works and stays cheap under load. It did **not**
meaningfully exercise the DB overlap-exclusion constraint (`expected409 = 0`) because rate limiting
shed the load before booking-overlap conflicts could form.

## Did not run (local data/config limitations — not failures)

| Step | Why skipped |
|---|---|
| Stripe webhook replay | The running server verifies against a different `STRIPE_WEBHOOK_SECRET` than the test signs with in this local env → 300× clean `400 STRIPE_SIGNATURE_INVALID`. Proves the signature guard rejects bad signatures, but is **not** a valid dedup/idempotency proof. Needs matching secret. |
| Booking finalize | Slot scarcity (12 seeded slots) — needs richer availability seed or `ALLOW_SLOT_REUSE`. |
| Checkout, Media metadata | Require pre-existing booking IDs; seed has **0 bookings**. |
| Signup, Notifications | Not run this pass (Turnstile/internal-job-secret config dependent); defer to a fuller local run. |

## What this does and does not establish

- **Does:** the availability read path is correct and fast (p99 < 100 ms) through 50 rps on a laptop;
  rate-limit shedding on a write path is clean and cheap; the production build boots and serves; the
  auth/cookie path and CSRF-origin guard work end-to-end.
- **Does not:** close the go/no-go load gate. That still requires a **deployed staging run** (pooled
  DB + replica + CDN + edge rate-limit) recording per-route p99 at the launch profile, plus seeding
  enough availability/bookings to exercise booking-finalize, checkout, media, and a
  correctly-signed webhook storm.

## Next step for the real gate

Stand up a staging deployment with test-mode Stripe/Postmark/Twilio and a throwaway DB seeded with
ample availability + bookings, set `STAGING_BASE_URL` + matching `STRIPE_WEBHOOK_SECRET` + minted
cookies, then run `pnpm test:load:launch` (full orchestrator) and record per-route p99 here and in
`load-test-plan.md`.
