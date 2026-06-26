# HANDOFF — Premortem remediation (2026-06-24 → 2026-06-25)

Continuation handoff for the full-app premortem remediation. Pairs with:
- `docs/audits/premortem-2026-06-24-pm.md` — the audit (findings, ranked).
- `docs/audits/premortem-2026-06-24-remediation-plan.md` — the full 16-PR plan
  (PR-by-PR: branch, files, approach, tests). **The plan is the source of truth
  for the remaining work** — this handoff is the status layer on top of it.

> Those two docs are **untracked** in the primary checkout
> (`/Users/torimorales/Dev/tovis-app/docs/audits/`). Consider committing them so
> they survive a `git clean`.

---

## Product decisions already made (don't re-ask)

1. **Pro overlap:** pros/admins MAY deliberately double-book → constraint is
   override-aware (shipped in 0B), not removed.
2. **Platform fee:** $0 on main bookings is INTENDED for now → Phase-4 PR-4A just
   pins it with a test + doc; do NOT add fee logic.
3. **dev==prod DB:** "full fix" — but it turned out the isolation half was already
   shipped on `main` (`prisma.config.ts` guards even raw `npx prisma db push`;
   `.env.development.local` targets the local DB). 0C added only the missing
   restore runbook.

---

## What's DONE (this session) — 7 PRs

All branches were cut from `origin/main`, validated (`typecheck` + `lint` +
`check:static-guards` + relevant vitest), and pushed (the pre-push hook runs the
FULL ~4630-test suite — budget for it).

| PR | Branch | Status |
|----|--------|--------|
| **#362** 0C — DB backup/restore runbook + isolation doc fixes | `fix/premortem-0c-db-separation` | MERGED |
| **#363** 0A — `charge.dispute.*` handling + refund freeze + Sentry alert | `fix/premortem-0a-stripe-disputes` | MERGED |
| **#364** 0B — override-aware overlap constraint (`allowsOverlap`) + 23P01 mapping | `fix/premortem-0b-overlap-override` | MERGED |
| **#365** 1A — `/api/search/pros` coordinate/address redaction | `fix/premortem-1a-search-pros-coords` | MERGED |
| **#366** 1C — boot-validate PII keyring + DATABASE_URL; cron-secret divergence warn | `fix/premortem-1c-boot-env-contract` | MERGED |
| **#367** 1B — captured-vs-expected Stripe amount-mismatch alert | `fix/premortem-1b-amount-reconciliation` | MERGED (was rebased onto main after 0A merged — conflict in `bookingEvents.ts`/`writeBoundary.ts` resolved, both Sentry helpers kept) |
| **#368** 1D — notification drain lease 120s (> cron `maxDuration`) | `fix/premortem-1d-notif-idempotency` | MERGED |

**= Phase 0 (catastrophic tier) + Phase 1 (severe leaks) COMPLETE.**

### 0B migration note (review before deploy)
`prisma/migrations/20260624020000_add_booking_overlap_override/` runs on the next
prod deploy. Validated end-to-end via `migrate deploy` on a throwaway DB (recipe
below). It adds `Booking.allowsOverlap` + `BookingHold.allowsOverlap` (default
false; backfill no-op) and rebuilds both EXCLUDE constraints with
`AND NOT "allowsOverlap"`.

---

## Operator follow-ups (need a human / console — I cannot do these)

- [ ] **Supabase PITR** — confirm it's enabled on prod (`tovis-dev`,
      `rqhhvuaoksuvbvlypztn`) + run a restore drill. Checklist in
      `docs/runbooks/db-restore.md`.
- [ ] **Stripe Dashboard** — subscribe the webhook endpoint to `charge.dispute.*`
      events, or 0A's handler never fires.
- [ ] Decide whether to **commit** the untracked audit/plan/handoff docs.

---

## What's LEFT — pick up here

### Deferred from 1D (#368) — notification hardening (tracked follow-ups)
The 120s lease closes the primary overlapping-drain double-send race. Two harder
steps remain (documented in the #368 commit):
1. **Drain singleton** — needs a pooler-safe lock TABLE (session `pg_advisory`
   locks are unreliable under pgbouncer transaction pooling). New model + migration.
2. **Provider idempotency keys** — Twilio Messages + Postmark expose no native
   idempotency, so a crash AFTER a send but BEFORE recording completion can still
   re-send on retry. Needs `providerMessageId` stamped pre-send + a dedupe check.

### Phase 2 — correctness — DONE (2026-06-26, PRs #370–#373, all OPEN)
- **2A** (#370 `fix/premortem-2a-utc-renders`) — pro reminders page + calendar
  move-confirm now render via `@/lib/time` in the appointment/schedule tz;
  shrank the `no-raw-datetime-format` baseline by 2.
- **2C** (#371 `fix/premortem-2c-reschedule-404`) — `lockClientOwnedBookingSchedule`
  now throws a structured `bookingError('BOOKING_NOT_FOUND')` for BOTH missing
  and non-owned (was a plain `Error('FORBIDDEN')` that fell through to
  INTERNAL_ERROR); `searchServices()` takes a `TenantContext` + scopes to the
  tenant's own pros' active offerings. Integration test uses a real `$transaction`
  tx (no type-escape).
- **2D part 1** (#372 `fix/premortem-2d-quiet-hours`) — quiet hours fail SAFE for
  missing/invalid recipient tz: fall back to `America/New_York` (conservative
  business zone, NOT UTC — UTC-gating still fires 3am Pacific) to gate quiet
  hours rather than SEND. **Follow-up (part 2):** give `APPOINTMENT_REMINDER`
  lead time so a just-in-time reminder for an early appt isn't deferred past it —
  needs `scheduledFor` threaded into the delivery-time policy
  (`runtimeChannelPolicy` has no appointment time today). The current
  ONE_WEEK/DAY_BEFORE kinds fire on prior days so the normal deferral stays
  before the appt; the edge is a late-booking past-due reminder.
- **2B** (#373 `fix/premortem-2b-busy-window`) — investigation showed the 3 (really
  ~5) busy-window definitions only diverge in the SAFE direction (JS window ≥ SQL
  floor) and the one unsafe case (>720/>180) is unreachable because writes clamp
  first → NO active bug. Per product call (don't degrade the safe over-reservation),
  shipped a **cross-test** instead of "match SQL": `sqlBusyWindowMinutes` helper
  mirrors the SQL floor exactly, `calculateWindowEnd` now floors at 1 (no 0-length
  windows), and `tests/integration/busy-window-sql-parity.test.ts` pins
  builder ≥ SQL (== on storable domain) against real Postgres. **Integration
  tests are NOT run by CI** (`vitest.config` excludes `tests/integration/**`, no
  workflow runs `test:integration`) — they are manual/local validation, same as
  the existing `bookingConcurrency`/`tenant-isolation` suites.

### Phase 3 — hardening (batchable)
- **3A** webhook/proof: Postmark webhook secret → `timingSafeEqual`
  (`lib/notifications/webhooks/postmark.ts:116,122,129`); consultation **decision**
  route use `getTrustedClientIpFromRequest` for consent-proof IP; consultation
  **GET** stop returning `proof.ipAddress`/`userAgent`/`recordedByUserId`/counterparty
  contact.
- **3B** rate-limit `account-invite` mint; treat unset `AUTH_TRUSTED_IP_HEADER` in
  prod as a hard startup failure.
- **3C** schedule `upload-sessions/cleanup` cron in `vercel.json` (+ GET export +
  `maxDuration`) — currently built but never runs → orphaned signed PII media.
- **3D** refund/deposit edges: stamp `stripeRefundId` before the Stripe call (or
  settle null-id PENDING rows by `(bookingId,amount,createdAt)`); shared
  idempotency key for orphan-recovery vs live webhook; model partial deposit
  refunds (don't flip `depositStatus→REFUNDED` on a partial).
- **3E** `connection_limit` on pooled `DATABASE_URL`; configure `DATABASE_URL_READ`;
  point `DIRECT_URL` at the true unpooled endpoint (not the session pooler).
- **(1B part 2)** extend the hourly `stripe-reconciliation` cron to pull each PI
  and assert captured/refunded totals vs local state.

### Phase 4 — decisions & docs
- **4A** pin the $0-platform-fee behavior with a test asserting final-bill + rebook
  PIs carry no `application_fee_amount` (deposit does) + a code/runbook note.
- **4B** document tenant root-fallback for unmatched hosts (safer default: deny /
  neutral tenant, not root); align `requestContext.ts` (raw `Host`) with
  `layoutContext.ts` (`x-forwarded-host`).
- **4C** `docs/audits/accepted-risks.md` (rate-limit fail-open, login captcha,
  single-region, forward-only migrate) + a burn-down process for the 584-entry
  plaintext-PII baseline + the `no-raw-datetime-format` baseline.

---

## How to work in this repo (lessons from this session)

- **Isolated worktree:** all work was done in `/Users/torimorales/Dev/tovis-app-premortem`
  (its own `node_modules` via `pnpm install` — NOT symlinked, so `prisma generate`
  there does NOT clobber the primary checkout). The primary checkout sits on a
  sibling session's branch; don't `git checkout` there.
- **One branch per PR, off `origin/main`, never stacked.** To start the next PR:
  `git checkout -b <branch> origin/main` (carries uncommitted work if any).
- **Pre-push hook runs the FULL suite.** It WILL catch tests you didn't run
  locally (it caught `writeBoundary.overlapPolicy*.test.ts`, `tests/chaos/db-degradation.test.ts`).
  Before pushing, run the full unit suite locally:
  `DATABASE_URL='postgresql://postgres:postgres@localhost:5434/tovis_dev' npx vitest run --config vitest.config.mts`
- **Rebase conflicts are likely** when a new PR touches a file a just-merged PR
  also touched (0A vs 1B on `bookingEvents.ts`/`writeBoundary.ts`). Rebase onto
  `origin/main` and resolve before merge.
- **Validate a migration against REAL Postgres** without touching prod:
  ```bash
  docker exec tovis-dev-postgres psql -U postgres -c "CREATE DATABASE tovis_scratch;"
  DATABASE_URL='postgresql://postgres:postgres@localhost:5434/tovis_scratch' \
  DIRECT_URL='postgresql://postgres:postgres@localhost:5434/tovis_scratch' \
    npx prisma migrate deploy
  # then run the integration test against it:
  DATABASE_URL='postgresql://postgres:postgres@localhost:5434/tovis_scratch' \
    npx vitest run tests/integration/booking-overlap-concurrency.test.ts \
    --config vitest.integration.config.mts --maxWorkers=1 --minWorkers=1
  docker exec tovis-dev-postgres psql -U postgres -c "DROP DATABASE tovis_scratch;"
  ```
  (The `db:test`/`db:dev` DBs are built via `prisma db push`, so they LACK the
  raw-SQL EXCLUDE constraints — only `migrate deploy` gives a prod-faithful schema.)
- **House rules** (`CLAUDE.md`): no `as any`/`as unknown as` (guard caught it in a
  test — build events via `Partial<>` + single cast); time/tz through `@/lib/time`;
  tone utilities not raw colors; brand strings from `lib/brand`.
- **Local dev DB** is already running: `tovis-dev-postgres` (:5434) +
  `tovis-test-postgres` (:5433). `pnpm db:dev:setup` to (re)seed.

---

*Status as of 2026-06-25. All 7 PRs (#362–#368) MERGED — Phase 0 + Phase 1
complete. Phases 2–4 (~9 PRs) remain — see the remediation-plan doc.*
