# Launch Traffic Model & Per-Route Targets

> Replaces the unscoped "10k concurrent users" acceptance criterion with a
> concrete traffic shape. Load tests (`tests/load/*`, `pnpm test:load:launch`)
> and the chaos suite measure against these numbers; go-no-go cites this
> document. Revisit after the first week of real beta telemetry.

## Status

Owner: Tori
Basis: 100,000 registered users at public launch, marketing-driven launch week.
Last reviewed: 2026-06-10

## Population model

| Quantity | Target | Notes |
|---|---:|---|
| Registered users | 100,000 | Public-launch planning number. |
| Launch-week peak concurrent sessions | 10,000 | Sessions with the app open, not active requests. |
| Active browsers at any instant | 1,000–2,500 | Campaign-dependent. |
| Registered Pros | ~5,000 | 20:1 client-to-pro assumption. |

## Request-rate model (peak)

| Flow | Peak rate | Driver |
|---|---:|---|
| Mixed read traffic (search, profiles, looks, availability) | 500–1,500 RPS | Browsing dominates; cache-heavy. |
| Availability bootstrap | 100–300 RPM | One per drawer open. |
| Hold create | 100–300/min | Slot selection. |
| Booking finalize | 50–150/min | Conversion from holds. |
| Pro session state polling | ≤ 1 req / 5–10s per *active, visible* session | Self-limiting: hidden tabs pause, terminal states stop. ~500 concurrent active sessions → ≤100 RPS of PK lookups. |
| Media upload burst | 20–100 files/min | Session before/after photos. |
| Stripe webhook burst | 500–1,000 events/min | Retry/replay storms; must dedupe idempotently. |
| Notification dispatch backlog threshold | < 5,000 queued | Alert above this (cron cadence is 5 min). |
| Signup burst | 30+/min sustained | Verified by signup load test. |

## Per-route latency targets

Server-side, measured at the route handler, excluding client network.

| Route | p95 | p99 | Notes |
|---|---:|---:|---|
| Availability bootstrap (cached) | 250 ms | 500 ms | versionedCache hit path. |
| Availability bootstrap (cold) | 700 ms | 1,200 ms | PostGIS + computation. |
| Day slots | 400 ms | 800 ms | |
| Search pros | 300 ms | 700 ms | Search index + tenant filter. |
| Hold create | 500 ms | 900 ms | Includes schedule lock. |
| Booking finalize | 800 ms | 1,500 ms | Transactional; includes conflict checks + tenant attribution (2 PK lookups). |
| Session state (poll) | 200 ms | 400 ms | Single PK read + hash. |
| Auth/session check | 200 ms | 400 ms | |
| Media metadata | 500 ms | 900 ms | |
| Webhook ingest (Stripe) | 300 ms | 600 ms | Ack fast, process async. |

Error-rate gates: 5xx < 0.5% per route at peak; hold/finalize conflict
(409-class) responses are correctness, not errors, and are excluded.

## Acceptance rule

A load result is a PASS only when: the run cites this document's rates, the
environment is deployed staging (not local), p95/p99 are within targets or a
ticketed bottleneck exists, and the result is recorded in
`docs/launch-readiness/test-proof.md` and `docs/deployment-checklist.md`
evidence fields.

## Known scaling notes

- Session polling is the largest new steady-state read source; it is bounded
  by design (visibility-aware, terminal-stop, 5s floor). If it ever shows up
  in p95 dashboards, the next steps are a shared per-booking cache or SSE.
- White-label tenant filters add an indexed subquery to search; denormalize
  `homeTenantId` onto ProfessionalSearchIndex if white-label search volume
  warrants it (noted in lib/tenant/visibility.ts).
- Vercel cron jobs (5-min cadence) bound notification/reminder latency;
  Inngest migration is the post-launch fix if backlogs exceed threshold.
