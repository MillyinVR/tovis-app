# TOVIS Premortem Remediation Plan — 2026-06-24

Companion to [`premortem-2026-06-24-pm.md`](./premortem-2026-06-24-pm.md). Fixes every open/new finding from the second-pass premortem, sequenced into focused, mergeable PRs (one risk-cluster per PR, per repo convention). Each item lists branch, files, approach, tests, and effort.

**Product decisions made (2026-06-24):**
- **Pro overlap:** pros/admins *may* deliberately double-book → the overlap EXCLUDE constraint becomes **override-aware** (not removed). Drives B1.
- **Platform fee:** $0 on main bookings is **intended for now** → document + pin with a test; no fee logic added. Drives M3.
- **dev==prod DB:** **full fix** → stand up a separate local DB, repoint `.env.local`, document+test a prod restore path. Drives O1.

**Conventions for every PR below:**
- Branch off `origin/main`, never stack (per memory lessons).
- Before push: `npm run typecheck && npm run lint && npm run check:static-guards` + the relevant `vitest` suites.
- No `as any`/`: any`; time/tz through `@/lib/time`; tone utilities not raw colors; brand strings from `lib/brand` (house rules).
- Pre-push runs the FULL suite — budget for it.

**Effort key:** S = <½ day · M = ½–1.5 day · L = 2–4 days.

---

## Phase 0 — Catastrophic / foundational (do first, do not batch)

### PR-0A · Stripe dispute handling — `charge.dispute.*`  ·  M
*Closes: Money #2 (top risk). Likelihood Med × Catastrophic.*
- **Problem:** `lib/stripe/handleWebhookEvent.ts:404-468` has no dispute cases; `StripePaymentStatus.DISPUTED` is only ever read (`writeBoundary.ts:14275`), never written. A disputed destination charge reverses the pro's transfer + debits the platform, but the booking still shows SUCCEEDED — a later refund then errors or double-claws the pro.
- **Approach:**
  1. Add `charge.dispute.created` / `charge.dispute.funds_withdrawn` / `charge.dispute.closed` cases to the `handleStripeEvent` switch.
  2. New write-boundary fn `applyStripeDisputeInTransaction` (mirror the locked-apply pattern): resolve booking by charge/PI id under advisory lock; set `stripePaymentStatus = DISPUTED` on `created`/`funds_withdrawn`; on `closed` map to `won → SUCCEEDED` / `lost → DISPUTED` (terminal). Idempotent on `stripeEventId`.
  3. **Freeze the refund path on disputed charges:** in `lib/booking/refunds.ts` `reserveRefund`, short-circuit to a new `REFUND_BLOCKED_DISPUTED` outcome when `stripePaymentStatus === DISPUTED`.
  4. Emit an ADMIN operational notification (reuse the AdminNotification surface) — disputes need human eyes.
  5. Ensure the `stripe-webhook-requeue` cron replays dispute events (it routes through `handleStripeEvent`, so free once cases exist).
- **Files:** `lib/stripe/handleWebhookEvent.ts`, `lib/booking/writeBoundary.ts`, `lib/booking/refunds.ts`, `lib/notifications/*` (admin alert), webhook event-type allowlist if any.
- **Tests:** new `vitest` — dispute created→DISPUTED, refund blocked while disputed, closed-won→SUCCEEDED, closed-lost terminal, out-of-order dispute events idempotent, requeue replays a failed dispute event.
- **Guards/risk:** touches the money write boundary → run `check:booking-boundary` + `check:lifecycle-field-writes`. No schema change (`DISPUTED` enum already exists).

### PR-0B · Override-aware overlap constraint  ·  M-L
*Closes: Booking #3 (top risk) + N3 partial. Likelihood High × Severe. Regression introduced by #356.*
- **Problem:** `Booking_no_active_professional_overlap` is unconditional, but `overlapPolicy.ts:161-175` grants `PRO_AUTHORIZED_OVERLAP`/`ADMIN_AUTHORIZED_OVERLAP`. The three `booking.create` catches (`writeBoundary.ts:8484,~8946,~9512`) handle only `P2002` → an authorized overlap hits an unhandled `23P01` → raw 500.
- **Approach (decision: allow authorized overlap):**
  1. **Migration (expand-phase):** add `allowsOverlap BOOLEAN NOT NULL DEFAULT false` to `Booking`. Recreate the EXCLUDE constraint with a `WHERE (NOT "allowsOverlap" AND status IN (...))` predicate so flagged rows are exempt. Mirror the same `allowsOverlap`-aware predicate onto `BookingHold` (`BookingHold_no_active_professional_overlap`) for symmetry.
  2. In the create/hold paths, set `allowsOverlap = true` exactly when `overlapPolicy` returns `PRO_AUTHORIZED_OVERLAP`/`ADMIN_AUTHORIZED_OVERLAP`; derive it from the policy result, never from client input (write-boundary only).
  3. **Defense in depth:** still add `isExclusionConstraintError(error)` → `TIME_NOT_AVAILABLE` mapping to all three create catches (today only the hold path at `6896` has it), so a genuine create/finalize race returns a clean error instead of 500.
  4. Backfill is a no-op (default false = current behavior).
- **Files:** `prisma/schema.prisma`, new `prisma/migrations/*`, `lib/booking/writeBoundary.ts` (3 create catches + hold), `lib/booking/overlapPolicy.ts` (wire result→flag).
- **Tests:** authorized overlap succeeds (no 500); unauthorized overlap still `23P01`→`TIME_NOT_AVAILABLE`; constraint still blocks two non-flagged bookings; hold parity. **Validate against a real Postgres** (test-DB recipe in memory `bookinghold-overlap-constraint`).
- **Risk:** migration on the shared prod DB — see PR-0C; apply via `prisma migrate deploy` only, never `db push`.

### PR-0C · dev==prod DB separation + tested restore  ·  L
*Closes: Ops #1 + N2 (catastrophic root cause). Decision: full fix.*
- **Problem:** `.env.local` `DATABASE_URL` points at the prod pooler (`aws-0-us-west-2.pooler.supabase.com`, project `rqhhvuaoksuvbvlypztn`); the Prisma guard (#344) is a speed-bump (`npx prisma db push` bypasses it); no documented backup/PITR/restore.
- **Approach (sequence, lowest-risk first):**
  1. **Stand up an isolated local Postgres** — reuse the existing `test-postgres` container pattern (memory `local-e2e-run-recipe`) as a dev DB, or a dedicated Supabase "tovis-local" project. Seed via existing `db:test:seed`.
  2. **Repoint `.env.local`** `DATABASE_URL`/`DIRECT_URL` to the local DB. Keep prod creds only in `.env.production.local`. Verify every local workflow (typecheck/vitest/dev server) runs against local.
  3. **Harden the guard** so raw `npx prisma db push`/`migrate reset` against any `*.pooler.supabase.com`/`supabase.co` host is refused even when invoked directly — e.g. a `prisma`-wrapper shim on PATH or a `PRISMA_HIDE_UPDATE_MESSAGE`-style preflight in an npm `prepare`/`predev`. Document the residual (a determined raw call can still bypass) and rely on #2 to make local the default target.
  4. **Backup/PITR posture:** confirm Supabase PITR is enabled on prod; document retention window, and write `docs/runbooks/db-restore.md` with a *tested* restore-to-a-branch procedure (use Supabase branch/restore, validate row counts). This is the missing recovery path.
- **Files:** `.env.local` (local only — not committed), `scripts/prisma-guard.cjs`, `package.json` scripts, `docs/runbooks/db-restore.md`, `.env.example` (note the local-vs-prod split).
- **Tests:** manual — prove a `db push` from repo root hits local not prod; prove the documented restore actually recovers a dropped table on a branch.
- **Risk:** highest-stakes item; do it on its own, with the user, before any other migration PR (0B) lands.

---

## Phase 1 — Severe security & money leaks

### PR-1A · Coarsen `/api/search/pros` coordinates + address  ·  S
*Closes: PII new#1 (top isolation risk). High × Severe.*
- **Problem:** `lib/search/pros.ts:145-156` (`mapLocationPreview`) emits `formattedAddress`, `placeId`, raw `lat`/`lng`; `app/api/search/pros/route.ts:16-24` returns it unauthenticated, uncoarsened — same home-address doxxing class fixed on `nearby`.
- **Approach:** reuse the existing `coarsenPublicCoordinate` (2-decimal) helper + null `formattedAddress`/`placeId` in `mapLocationPreview`, exactly as `lib/discovery/nearbyPros.ts:79-111` does. Audit `/api/search?tab=pros` shares the same mapper.
- **Tests:** snapshot the public DTO has no street address/placeId and 2-decimal coords; add `lat`/`lng` for `Service`/search models to the PII guard field list if applicable.
- **Guards:** `check:pii-plaintext-reads` (it now covers `lat`/`lng`).

### PR-1B · Captured-vs-expected amount reconciliation  ·  M
*Closes: Money #2 (prior, still open). Med × Severe.*
- **Problem:** `writeBoundary.ts:14177-14178` writes `stripeAmountTotal = amountReceivedCents` with no compare to the prepared expected total (`amountCents`, `:13487`). Short/over/wrong-currency capture becomes truth.
- **Approach:**
  1. At success apply, compare `amount_received` (+ `currency`) to the prepared expected; on mismatch beyond a 0-cent tolerance, still record the captured value (it's real money) **but** flag the booking (`paymentAmountMismatch` / audit-log entry) and emit an ADMIN alert. Never silently overwrite without signal.
  2. Extend the hourly `stripe-reconciliation` cron to pull each booking's PI and assert captured/refunded totals vs local state, logging drift.
- **Files:** `lib/booking/writeBoundary.ts`, `lib/stripe/*reconciliation*`, admin alert.
- **Tests:** exact-match no-op; short-pay flags + alerts; currency mismatch flags; reconcile cron surfaces a seeded drift.

### PR-1C · Boot fail-closed env contract + cron-secret assertion  ·  S
*Closes: Ops N1 (#7) + Money N6 (#9). Med × Severe / Low × Severe.*
- **Problem:** `startupEnvValidation.ts:25-44` omits `PII_AEAD_KEYS_JSON` + `DATABASE_URL` (AEAD read lazily, `aead.ts:37`) → dropped keyring boots green, throws on first PII op. Cron auth uses `INTERNAL_JOB_SECRET ?? CRON_SECRET` (`internalJob.ts:9-11`) — divergent values silently 401 every heal cron.
- **Approach:**
  1. Add `PII_AEAD_KEYS_JSON` (parse + validate keyring shape) and `DATABASE_URL` to the boot contract so a bad/missing value fails the deploy loudly, not lazily.
  2. Add a startup assertion: if both `INTERNAL_JOB_SECRET` and `CRON_SECRET` are set and differ, log a fatal/Sentry warning (Vercel cron only carries `CRON_SECRET`); document the precedence in `.env.example`.
- **Files:** `lib/observability/startupEnvValidation.ts`, `.env.example`.
- **Tests:** unit — missing AEAD/DATABASE_URL fails validation; mismatched secrets warns.

### PR-1D · Notification provider idempotency + drain singleton  ·  M
*Closes: Notif N1 (#6) + N3. Med × Severe.*
- **Problem:** `idempotencyKey` is internal-only (not sent to Twilio `messages.create` `sendSms.ts:282`; Postmark only `Metadata` `sendEmail.ts:396-404`); lease is 60s (`claimDeliveries.ts:18`) while the process cron is `* * * * *` with `maxDuration=60` and serial 250-batches → a >60s drain overlaps and re-sends real billed messages.
- **Approach:**
  1. **Widen the lease beyond the cron period** (e.g. 120–180s, and/or pass an explicit `leaseMs` to `drainDueNotifications`) so a slow batch can't have its rows reclaimed mid-send.
  2. **Add a drain singleton** — `pg_advisory_lock` (try-lock, skip if held) around `notifications/process` so overlapping cron ticks + route `kickNotificationDrain` can't run concurrently.
  3. **Stamp a provider-side idempotency key** where supported: persist `providerMessageId` before send and pass Twilio's idempotency mechanism; for Postmark, gate on a pre-send `providerMessageId` check. Belt-and-suspenders with the lease.
- **Files:** `lib/notifications/delivery/{sendSms,sendEmail}.ts`, `claimDeliveries.ts`, `runNotificationDrain.ts`, `app/api/internal/jobs/notifications/process/route.ts`.
- **Tests:** simulate a >lease drain → no double-send; concurrent drains → singleton skips; provider key present on send.

---

## Phase 2 — Correctness (timezone, enumeration, quiet hours)

### PR-2A · Finish the UTC/wrong-tz appointment renders  ·  S
*Closes: Time N2 (#11). High × Moderate.*
- **Problem:** `app/pro/reminders/page.tsx:42` (server `toLocaleString`, no `timeZone` → UTC on Vercel) and `app/pro/calendar/_components/ConfirmChangeModal.tsx:46` (reschedule confirm renders viewer tz, not `locationTimeZone`).
- **Approach:** route both through `@/lib/time` `formatInTimeZone(..., resolveAppointmentDisplayTimeZone(booking.locationTimeZone, tz))`, matching the already-fixed `app/pro/clients/[id]/page.tsx`. Shrink the `no-raw-datetime-format` baseline by these entries.
- **Guards:** `check:no-raw-datetime-format` (migrate, don't re-baseline).
- **Tests:** render test asserting an evening US appt shows the correct local day/time, not UTC.

### PR-2B · Unify the busy-window definition + cross-test against SQL  ·  M
*Closes: Booking N3. Low × Moderate (defense-in-depth for the constraint).*
- **Problem:** three divergent busy-window computations for the same hold — SQL `tovis_booking_overlap_range` (`GREATEST(1,…)`), JS `holdToBusyInterval` (clamp, NULL→60), runtime `calculateWindowEnd` (NULL→0). Agree for clean data; diverge on NULL/odd snapshots; the #359 invariant test covers none against each other.
- **Approach:** make the three agree on NULL/clamp semantics (single source helper for min/clamp/fallback), then extend the invariant test to assert the JS builders match the **SQL** `tovis_booking_overlap_range` output and the runtime `calculateWindowEnd` across the scenario matrix (run against real Postgres).
- **Files:** `lib/booking/schedulingConflicts.ts`, `lib/availability/*`, `lib/booking/occupancyInvariant.test.ts`.

### PR-2C · Reschedule enumeration 404 + tenant filter on search/services  ·  S
*Closes: PII item#4 residual + new#2. Med × Moderate / Med × Low.*
- **Approach:** `lib/booking/scheduleTransaction.ts:55` → throw `BOOKING_NOT_FOUND` for non-owned (match the 3 paths #352 fixed). Add `proDiscoveryVisibilityFilter`/tenant scope to `searchServices()` (`app/api/search/services/route.ts`) like every other discovery surface.
- **Tests:** non-owned reschedule returns uniform 404; cross-tenant service not returned.

### PR-2D · Quiet-hours: default null timezone + reminder lead time  ·  S-M
*Closes: Notif N5 + item#3. Med × Low-Moderate (TCPA) / Med × Moderate.*
- **Approach:**
  1. **Null tz fails *safe*, not open:** in `channelPolicy.ts` (`getRecipientLocalMinutes` ~`:349,374`), when recipient tz is absent fall back to the booking-location tz (or a conservative business default) rather than disabling quiet hours → no 3am SMS for unclaimed/phone-only clients.
  2. **Reminder lead time:** for `APPOINTMENT_REMINDER` (`eventKeys.ts:333`), either send earlier (compute `runAt` to land before quiet hours) or allow same-morning bypass, so a 07:00 appt's reminder isn't deferred to 08:00 (after the appt).
- **Tests:** null-tz recipient → quiet hours enforced via fallback; early-morning appt reminder lands before the appt.

---

## Phase 3 — Hardening (lower severity, batch-friendly)

### PR-3A · Webhook/proof hardening bundle  ·  S
*Closes: PII new#4 + Auth new#2 + PII new#5 + Auth item#6.*
- Postmark webhook secret → `timingSafeEqual` (`lib/notifications/webhooks/postmark.ts:116,122,129`), matching the internal-job/Twilio paths.
- Consultation **decision** route: use `getTrustedClientIpFromRequest` instead of raw `x-forwarded-for`/`x-real-ip` when persisting consent proof (`decision/route.ts:111-119`) — un-spoofable audit trail.
- Consultation **GET** (`public/consultation/[token]/route.ts:220-238`): stop returning `proof.ipAddress`/`userAgent`/`recordedByUserId`/counterparty contact to the token bearer — return only what the recipient needs.

### PR-3B · Public-POST + IP-bucket hardening  ·  S
*Closes: Auth new#3 + new#4.*
- Add a rate limiter to `account-invite` mint (`public/account-invite/[token]/route.ts:18-49`) — dual IP + token-prefix bucket like the consultation decision route.
- Treat unset `AUTH_TRUSTED_IP_HEADER` in prod as a hard startup failure (it already fatal-alerts) so IP limiters can't silently collapse to one shared `ip:'unknown'` bucket.

### PR-3C · Schedule the upload-sessions cleanup cron  ·  S
*Closes: Ops N3. High (already true) × Low-Medium.*
- Add `/api/internal/jobs/upload-sessions/cleanup` to `vercel.json` crons; add a `GET` export (Vercel cron uses GET) + `maxDuration`. Orphaned signed-but-unattached PII media is currently never reaped.
- **Tests:** cron reaps an expired UploadSession + its storage object.

### PR-3D · Refund/deposit edge correctness  ·  M
*Closes: Money N3 + N4 + N5.*
- **N3:** stamp `stripeRefundId` on the reserve row *before* the Stripe call (or have the reconcile sweep also settle PENDING rows by `(bookingId, amount, createdAt)` when `stripeRefundId` is null) so a crash between reserve→settle doesn't strand a PENDING row permanently reserving headroom.
- **N4:** give orphan-recovery and the live webhook a **shared** idempotency key (derive from PI/session id, not a synthetic `orphan_recovery:*`) so the second arrival no-ops instead of re-applying.
- **N5:** model partial deposit refunds — don't flip `depositStatus → REFUNDED` on a partial amount (`writeBoundary.ts:14031-14043`); track refunded-cents so a later full app-side deposit refund isn't blocked.

### PR-3E · Connection pooling + migrate endpoint  ·  S-M
*Closes: Ops N5 + N4.*
- Add an explicit `connection_limit` to the pooled `DATABASE_URL` sized for serverless fan-out; configure `DATABASE_URL_READ` to the read replica so reads don't all land on the primary pool (`lib/prisma.ts:27-33`).
- Point `DIRECT_URL` (migrate path) at the true unpooled `db.<ref>.supabase.co:5432` endpoint, not the session pooler, to stop `migrate deploy`/advisory-lock hangs (memory: "migrate diff hangs on pooler").
- **Tests:** manual — migrate over direct endpoint completes; read path uses replica.

---

## Phase 4 — Decisions, docs & accepted risks

### PR-4A · Pin the $0-platform-fee behavior  ·  S
*Closes: Money #8 (decision: intended for now).*
- Add a test asserting final-bill + rebook PaymentIntents carry **no** `application_fee_amount` (while deposit does), so the current intentional state can't drift silently. Add a code comment + a one-line note in the payments runbook documenting the decision and the revisit trigger (before scale / when a fee model is introduced).

### PR-4B · Document tenant root-fallback + align host trust  ·  S-M
*Closes: PII item#6 + new#3. Low × Catastrophic.*
- Decide and **document** the behavior for a host not matching an active `customDomain`: today `resolveTenant.ts:126-140` falls back to root (cross-tenant). Safer default: unmatched host → **deny / neutral tenant**, not root. At minimum align `requestContext.ts:18` (raw `Host`) with `layoutContext.ts:30-31` (`x-forwarded-host`) and confirm the Vercel edge overwrites client-supplied `Host`. Add a test for the unmatched-host path.

### PR-4C · Accepted-risk register + plaintext-PII burn-down  ·  S
*Closes: Auth item#3, item#4, Ops item#3/#6, PII item#5.*
- Write a short `docs/audits/accepted-risks.md` recording the deliberate trade-offs with rationale + revisit triggers: rate-limit fail-open on Redis outage (availability over strictness), login captcha omission (defended by lockout + timing), single-region pin (latency over failover), migrate-on-deploy forward-only (mitigated by expand-phase discipline).
- Stand up a **burn-down process** for the 584-entry plaintext-PII baseline (`tools/baselines/pii-plaintext-reads.txt`): owner, target, and a rule that the baseline may only shrink. Same for the `no-raw-datetime-format` baseline.

---

## Suggested sequencing

1. **PR-0C first, with the user** (DB separation) — it de-risks every later migration. Then **PR-0A** (disputes) and **PR-0B** (overlap constraint) — the two highest correctness risks.
2. **Phase 1** in parallel after 0C lands (1A/1B/1C/1D are independent).
3. **Phase 2** correctness, then **Phase 3** hardening (batchable).
4. **Phase 4** docs/decisions can land any time; PR-4A should accompany PR-0A/1B so payment behavior is pinned while it's fresh.

**Independent of the DB work** (can start immediately, no migration): 1A, 1C, 1D, 2A, 2C, 2D, 3A, 3B, 3C, 4A, 4C.
**Need a migration / DB validation** (gate on 0C): 0B, 1B (audit fields), 3D, 3E.

---

*Plan only — no code changed. Pairs with the premortem audit docs in this directory.*
