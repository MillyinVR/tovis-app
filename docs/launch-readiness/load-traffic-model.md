# Load traffic model & per-route p99 targets

Defines the traffic *shape* and per-route latency budgets the deployed staging
load gate must meet before private beta. Without this, "10k concurrent" is
unmeasurable — a load test needs a mix and a pass/fail line. This is the
acceptance criteria for `pnpm test:load:launch` (see
`tests/load/run-launch-load-suite.ts`), run against a deployed staging env.

Status: **targets defined, not yet measured.** Fill the "Measured" columns from
the staging run and mark each route pass/fail.

---

## Launch traffic model (assumptions)

Scale we are sizing for — 100k registered users, marketing-driven launch week:

| Quantity | Launch-week value | Notes |
|---|---|---|
| Registered users | 100,000 | day-1 ceiling |
| Peak concurrent sessions | 10,000 | launch-week spike |
| Active browsers at a time | 1,000–2,500 | varies with campaign |
| Mixed read RPS | 500–1,500 | dominated by availability + looks reads |
| Booking finalize attempts | 50–150 / min peak | the contended write path |
| Hold (slot lock) attempts | 100–300 / min peak | rate-limited; sheds to 429 |
| Media upload burst | 20–100 files / min | metadata path, not blob throughput |
| Webhook burst | 500–1,000 events / min | during Stripe retry/replay |
| Signups | up to ~200 / min | launch-day spike, Turnstile-gated |

Read:write skew is heavy-read (~95/5). The hot read paths are availability
bootstrap and the looks feed; the risk paths are booking finalize (DB overlap
constraint) and checkout (Stripe round-trip).

---

## Per-route p99 targets

Each row maps to a suite step. Targets are p99 unless noted. "Cold" = no cache /
first hit; "cached" = warm read path.

| Route / step | Suite step | Target p99 | Measured | Pass? |
|---|---|---|---|---|
| `GET /api/availability/bootstrap` | `availability-bootstrap` | < 250 ms cached, < 700 ms cold | | |
| Day-slot expansion (within availability) | `availability-bootstrap` | < 400 ms | | |
| `POST` hold create | `hold-create` | < 500 ms (429 shedding is a pass, not a failure) | | |
| Booking finalize | `booking-finalize` | < 800 ms; **0 double-bookings under overlap contention** | | |
| Checkout (Stripe session create) | `checkout` | < 800 ms | | |
| Pro session state poll | (covered by `app/api/pro/bookings/[id]/session/state`) | < 200 ms | | |
| Media metadata | `media-metadata` | < 500 ms | | |
| Webhook ingest | `stripe-webhook-replay` | < 300 ms; **dedup holds under replay storm** | | |
| Signup | `signup` | < 900 ms (Turnstile-gated) | | |
| Notification processing | `notifications` | drains backlog within one cron interval (5 min) | | |

Sustained-load shape for the suite orchestrator: ramp 10 → 50 → 100 rps on the
read paths; drive the write paths at the per-minute peaks above, not at read
RPS. Booking finalize **must** be exercised against a seed that actually
contains overlapping bookable slots — the local proof could not (0 bookings in
the dev seed), which is exactly the gap this gate closes.

---

## What the run must produce

1. Per-route p99 recorded above; every route green or a ticketed bottleneck.
2. Booking-finalize overlap test: N concurrent finalizes on the same slot →
   exactly one success, rest cleanly rejected, **zero** double-books.
3. Webhook replay: duplicate events deduped, no double state transitions.
4. DB pooling holds (Supabase pooler; read replica if provisioned) — this is the
   dimension the single-laptop local proof could not exercise.

## Running it (deployed staging)

The suite already targets `STAGING_BASE_URL` and skips steps whose env is
missing. Required env per the orchestrator:

- Base: `STAGING_BASE_URL`
- Discovery/holds: `LOAD_TEST_PROFESSIONAL_ID`, `LOAD_TEST_SERVICE_ID`,
  `LOAD_TEST_CLIENT_COOKIE`
- Checkout: `LOAD_TEST_CHECKOUT_BOOKING_ID`, `LOAD_TEST_PRO_COOKIE`
- Media: `LOAD_TEST_MEDIA_BOOKING_ID`, `LOAD_TEST_PRO_COOKIE`,
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Webhook: `STRIPE_WEBHOOK_SECRET` (must match staging's signing secret — the
  local run failed here on a secret mismatch)
- Signup: `TURNSTILE_TEST_TOKEN`

```
# against deployed staging, with the above env populated:
pnpm test:load:launch
# or chaos + load together:
pnpm verify:launch-ops
```

Record results into a dated `docs/launch-readiness/staging-load-proof-<date>.md`,
mirroring the honest format of `local-load-proof-2026-06-12.md` (state what was
proven and what was not).
