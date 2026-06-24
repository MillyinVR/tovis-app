# TOVIS Launch Premortem — 2026-06-24

**Method:** premortem ("it's 3 months post-launch and Tovis is in crisis — why?"). Six parallel investigators traced the highest-blast-radius failure domains against real code: money/payments, tenant-isolation/PII, booking-integrity/time, auth/abuse, notifications/delivery, and deploy/data/ops. Each finding carries file:line evidence and a likelihood × blast-radius rating.

**Baseline:** `main` @ `042692c9`.

**Posture:** The core engineering is launch-grade. Booking overlap has a real Postgres `EXCLUDE` constraint + advisory locks + concurrency tests; ownership gating on charts/bookings/media/messages is disciplined and consistent; the Stripe happy path has webhook dedup, advisory locks, and an orphan-recovery sweep. The chart/technical-record surface — the scariest breach target — is clean. **The risk lives in the edges the static guards structurally cannot see, and in the operational coupling of dev to prod** — none of the Top 12 below would be caught by the weekly scorecard.

---

## Cross-cutting root causes

Five themes generate most of the individual risks:

1. **`dev` and `prod` share the same Supabase database.** `.env.local` and `.env.production.local` carry a byte-identical `DATABASE_URL` (project `rqhhvuaoksuvbvlypztn`). This is the master foot-gun: it turns three survivable risks into catastrophes — a stray `prisma db push`/`migrate dev` wipes prod, a load test bills real Twilio/Postmark, and any "staging" drain hits live delivery rows. **(Fix #1 below — first layer landed 2026-06-24.)**
2. **Local state is trusted as the complete ledger; Stripe-side truth is never reconciled back.** Dashboard refunds, actual captured amounts, and out-of-order webhook events drift silently. Root cause of four money risks.
3. **Baseline-suppressed guards give a green checkmark over real debt.** ~111 baselined raw `toLocale*`/`Intl` sites (→ wrong-day render bug), 537 baselined plaintext-PII reads, and `lat`/`lng` not even in the PII guard's field list. "Guards pass" ≠ safe.
4. **Unauthenticated, keyed proxies.** Three anonymous endpoints sit over paid/sensitive backends: `nearby` (precise addresses), `pro-license/verify` (licensee PII + gov creds), and four Google Maps routes (billing).
5. **Quiet-hours defers critical *client* messages.** The engine is otherwise solid, but the actor (pro) is alerted instantly while the client's own confirmation can sit until 08:00 local.

---

## Top 12 risks (ranked by likelihood × blast radius)

| # | Risk | Likely? | Blast | Domain |
|---|------|---------|-------|--------|
| 1 | **`prisma db push`/`migrate dev` from repo root hits PROD** — identical dev/prod URL; `_safe-script-guard` never sees the Prisma CLI | Med | ☠️ Catastrophic | Ops |
| 2 | **Unauthenticated `/api/pros/nearby` leaks exact street addresses + precise lat/lng** of home-based pros; `lat`/`lng` aren't in the PII guard | High | Severe | Isolation |
| 3 | **Pro screens render booking dates in UTC, not appointment TZ** → Fri 7pm shows as Saturday | High | Severe | Time |
| 4 | **Load-test kill switch doesn't exist in this tree** + dev==prod → load test bills real SMS/email | High | Severe | Notif |
| 5 | **4 Google Maps proxies + `pro-license/verify` are fully public** → billing drain / quota ban / licensee doxxing; `google:proxy` bucket exists but is wired to nothing | High | Severe | Auth |
| 6 | **Dashboard/partial refunds are invisible to auto-refund math** → double refund + over-clawback from pro | Med | Severe | Money |
| 7 | **Out-of-order `payment_intent.payment_failed` downgrades a SUCCEEDED booking to FAILED** (no downgrade guard) | Med | Severe | Money |
| 8 | **No amount reconciliation** — webhook records `amount_received` as refund source-of-truth with no check vs expected total | Med | Severe | Money |
| 9 | **Render/orchestration error → `FAILED_FINAL`, no retry** — one missing env var permanently drops every in-flight confirmation/payment alert in the batch | Med | Severe | Notif |
| 10 | **Rate limiting fails OPEN on Redis outage** for all non-auth buckets (token brute-force, NFC, holds, finalize) | Med | Severe | Auth |
| 11 | **No deploy/rollback runbook + forward-only migrations** — reverting a `vercel --prod` deploy leaves new schema under old code | Med | Severe | Ops |
| 12 | **`BOOKING_CONFIRMED` has no SMS channel and its email is quiet-hours-deferrable** — client books at 11pm, hears nothing until 08:00 | High | Moderate | Notif |

**Honorable mentions:** true double-book if a booking row ever has wrong `duration`/`buffer` (Catastrophic / Low — no invariant test); `BookingHold` lacks the overlap DB constraint that bookings have; public reviewer full-name/email exposure on pro profiles; booking-id enumeration via 404-vs-403 on 3 client write paths; missing `INTERNAL_JOB_SECRET` silently 500s every cron; tenant `isRoot` short-circuit if a white-label host misresolves (Catastrophic / Low).

---

## Domain detail & evidence

### 💸 Money / payments
1. **Dashboard refunds invisible to refund math → double refund.** `lib/booking/refunds.ts:105-110` sums `BookingRefund` rows only; dashboard refunds intentionally create no row (`:500-503`); partial dashboard refund leaves `stripeAmountTotal`/status untouched (`:537-549`), so the full amount looks refundable. `reverse_transfer:true` then over-claws the pro. **Med · Severe.**
2. **No amount reconciliation.** `lib/booking/writeBoundary.ts:14144-14159` writes `stripeAmountTotal = amount_received` with no equality check vs `totalAmount`/`subtotalSnapshot`; orphan recovery trusts it too. **Med · Severe.**
3. **Final-bill refund uses `reverse_transfer:true` with no `application_fee_amount`** (checkout `:224-233`, refunds `:189-190`) — correct for today's zero-fee model, silently wrong the moment a platform fee is added. **Med · Severe.**
4. **Out-of-order `payment_failed` downgrades SUCCEEDED→FAILED.** `writeBoundary.ts:14243-14263` — failed handler dedupes only on `stripeEventId`, no status guard (succeeded path has one). Flipped booking blocks refunds too. **Med · Severe.**
5. **Client idempotency = 32-bit djb2 in a 60s bucket, no nonce on checkout routes** (`lib/idempotency/client.ts:5-11,40-53`; `checkout/stripe-session/route.ts:189-192,235`) → cross-bucket retry can mint a second PaymentIntent. **Med · Severe.**
6. **No requeue for failed webhook events** other than `payment_intent.succeeded` (`webhooks/stripe/route.ts:587-605`); a permanently-failed `account.updated` can leave a pro unable to get paid. **Low-Med · Severe.**
7. **Refund Stripe-call and DB-settle are separate transactions** (`refunds.ts:294-364`); a crash between leaves a SUCCEEDED Stripe refund recorded PENDING, recoverable only via the `charge.refunded` webhook. **Low · Moderate.**

> Single highest-value money fix: a periodic reconciliation job that pulls each booking's PaymentIntent and compares captured/refunded totals to local state — closes #1, #2, #6, #7 at once.

### 🔒 Tenant isolation / PII
1. **`GET /api/pros/nearby` is unauthenticated** (`route.ts:25`) and returns `formattedAddress` + precise `lat`/`lng` (`lib/discovery/nearbyPros.ts:68-70`, `lib/discovery/nearby.ts:8-16`) for home-based pros. **High · Severe.**
2. **`lat`/`lng`/coordinates absent from the PII guard's field list** (`tools/check-pii-plaintext-reads.mjs:82-108`) — this leak class is structurally unguarded; #1 is the first instance, not the last. **High (latent) · Severe.**
3. **Public pro-profile reviews leak reviewer full name + email fallback** (`lib/profiles/publicProfileSelects.ts:100-119`, `publicProfileFormatting.ts:240-252`). **High · Moderate.**
4. **Booking-id enumeration via 404-vs-403 split** on `checkout`, `checkout/products`, `review` client write paths (`writeBoundary.ts:3048,2995,3085` throw FORBIDDEN; siblings correctly return uniform `BOOKING_NOT_FOUND`). Ownership IS checked — only the status code leaks existence. **Med · Moderate.**
5. **537-entry plaintext-PII-read baseline is accepted, un-reviewed debt** (guard is a contract audit, not an encryption proof). **Med · Severe.**
6. **Tenant isolation is host-derived; `isRoot` short-circuits all visibility filters** (`lib/tenant/visibility.ts:23-28`, `resolveTenant.ts:126-140`) — a misresolved white-label host becomes cross-tenant. **Low · Catastrophic.**

> The "forgot the ownership filter on a by-id route" failure mode is largely absent — booking/chart/media/address/message surfaces are properly scoped. The real vectors are over-sharing discovery endpoints and the coordinate guard blind spot.

### 📅 Booking integrity / time
1. **Pro server-component screens render booking dates in UTC.** `app/pro/clients/[id]/page.tsx:385` (`toLocaleString` with no `timeZone`, used at 490/939/1046/1202) and `app/pro/clients/page.tsx:20`. Evening US appointments cross midnight-UTC → wrong day. ~111 baselined raw `toLocale*`/`Intl` sites mean guards don't fail. **High · Severe.**
2. **`BookingHold` has no overlap DB constraint** — bookings have `Booking_no_active_professional_overlap` (EXCLUDE gist), holds rely solely on the advisory lock + app check; a future hold-write path that skips the lock loses all durability. **Med · Severe.**
3. **Booking overlap constraint depends on correct stored `bufferMinutes`/`totalDurationMinutes`** (`migration 20260522…`); replay path sets `stepMinutes:0` and reconstructs rather than recomputes (`writeBoundary.ts:2489-2494`). A bad row evades both app check and constraint → true double-book. **Low-Med · Catastrophic.** No invariant test.
4. **Reschedule/finalize use separate idempotency routes**; a double-submit produces a confusing late failure (not corruption — lock + hold-delete serialize it). **Med · Moderate.**
5. **Holds self-delete on re-hold** (`writeBoundary.ts:6709-6723`) — correct under the lock, fragile if lock scope ever narrows. **Low · Moderate.**
6. **DST display edge** in locally-recomputed end-time labels (core math is TZ-aware/correct). **Low · Moderate.**

### 🛡️ Auth / abuse
1. **`/api/pro-license/verify` is fully public** (`route.ts:209`), proxies the CA DCA gov API with Tovis secrets and returns licensee name + `raw: data` (`:343`). Enumeration → doxxing + credential ban. **High · Severe.**
2. **4 Google Maps proxies public, 0 auth/0 rate-limit** (`/api/google/{geocode,places/autocomplete,places/details,timezone}`); the `google:proxy` bucket (`lib/rateLimit/policies.ts:142`) is dead config — no route imports it. **High · Severe.**
3. **Rate limiting fails OPEN on Redis outage** for every non-`auth-critical` bucket (`lib/rateLimit/enforce.ts:265`) — token brute-force/NFC/holds/finalize unthrottled exactly under stress. **Med · Severe.**
4. **Login has no captcha** (register does); only defense under Redis outage is per-instance memory counting. **Med · Moderate.**
5. **Consultation/rebook/checkout token endpoints anonymous + captcha-less** (well-built otherwise: single-use, hashed, dual buckets). **Med · Moderate.**
6. **Consultation public GET leaks proof IP/User-Agent** (`route.ts:228-231`). **Low · Moderate.**
7. **NFC tap mints a `TapIntent` per request; rate-limit fail-open** (bot filter + TTL + cleanup cron mitigate). **Low · Moderate.**

> Per-route guard model is otherwise sound: deprecation stubs, admin/internal-job/webhook routes all verified guarded.

### 📨 Notifications / delivery
1. **`LOAD_TEST_DISABLE_REAL_DELIVERY` kill switch does not exist in this tree** (unmerged branch); `runNotificationDrain.ts:97-109` + `sendSms.ts:269` send unconditionally. Combined with dev==prod, a drain bills real Twilio/Postmark. **High · Severe.**
2. **`BOOKING_CONFIRMED` has no SMS channel and is quiet-hours-deferrable on email** (`eventKeys.ts:143-161`; defer at `claimDeliveries.ts:330-359`; default 22:00-08:00 for everyone with no pref row). **High · Moderate.**
3. **`APPOINTMENT_REMINDER` does not bypass quiet hours** (`eventKeys.ts:324-338`) — early-morning reminders pushed late/lose lead time. **Med · Moderate.**
4. **Twilio exceptions with no error code classified RETRYABLE** (`providerStatus.ts:232-233`) — post-charge SDK throws → repeated billed sends (bounded by `maxAttempts`, no provider-side idempotency key). **Med · Moderate.**
5. **Orchestration/render errors → `FAILED_FINAL`, no retry** (`processDueDeliveries.ts:371-391`; `renderNotificationContent.ts:106-110` throws on missing `APP_URL`) — a config slip silently, permanently drops critical messages. **Med · Severe.**
6. **Quiet-hours defer can drop to zero channels** for phone-only clients on non-bypass events (`channelPolicy.ts:324-333`). **Med · Moderate.**
7. **SMS requires both `phoneVerifiedAt` AND `transactionalSmsConsentAt`** (`channelPolicy.ts:326-329`); a backfill gap silently silences all SMS for legacy/imported users. **Med · Moderate-Severe** (TCPA-correct by design).

> Verified non-risks: lease/dedup makes double-send safe; quiet-hours starvation is handled; reminder SMS times render in the client's zone.

### ⚙️ Deploy / data / ops
1. **dev==prod DB, no CLI guard** (`.env.local` == `.env.production.local`; `_safe-script-guard.cjs` covers only 2 `.cjs` scripts, not the Prisma CLI). **Med · Catastrophic.** *(Fix #1 — first layer landed.)*
2. **No deploy/rollback runbook** for the manual `vercel --prod` path (git auto-deploy disabled); 15 runbooks, none for rollback. **Med · Severe.**
3. **Migrate-on-deploy is forward-only and build-coupled** (`vercel.json` buildCommand) — reverting a deploy leaves new schema under old code. **Med · Severe.**
4. **Cron routes set no `maxDuration`** — a backed-up every-minute drain truncates mid-batch under load. **Med · Moderate** (per-run batch caps prevent runaway).
5. **No `.env.example`; sensitive vars unpullable** — a missing `INTERNAL_JOB_SECRET`/`PII_AEAD_KEYS_JSON`/`DATABASE_URL_READ` silently darkens a subsystem (crons 500). **Med · Severe.**
6. **Single-region pin (`pdx1`) co-located with DB** — deliberate latency trade, no failover. **Low · Severe.**
7. **Serverless connection fan-out** — pgbouncer + singleton + read replica are correct, but no explicit `connection_limit`; pooler ceiling is the only backstop. **Low-Med · Severe.**

---

## Fix-first shortlist

1. **Guard the Prisma CLI against prod (#1)** — ✅ first layer landed 2026-06-24: `scripts/prisma-guard.cjs` + `npm run db:push`/`migrate:dev`/`migrate:reset`/`db:guard`. **Residual:** raw `npx prisma db push` still bypasses it; the durable fix is to make the local DB the default `.env.local` target.
2. **Auth-gate + rate-limit the public proxies (#2, #5)** — wire the existing `google:proxy` bucket onto all 4 Google routes; auth + strip `raw`/coordinates from `nearby` and `pro-license/verify`; add `lat`/`lng` to the PII guard.
3. **Route `pro/clients` date formatters through `@/lib/time`** with the booking's location TZ (#3) — kills the "wrong times" complaints; ~5 call sites.
4. **Merge the load-test delivery kill switch** before any load test (#4).
5. **Stripe reconciliation job (#6, #7, #8)** — one job closes three money risks; add a "never downgrade SUCCEEDED→FAILED" guard.
6. **Make confirmations/payment-alerts retry instead of `FAILED_FINAL` (#9);** consider letting `BOOKING_CONFIRMED` send SMS / bypass quiet hours (#12).

---

*Read-only premortem across the repo; the only write action was implementing fix #1 (the Prisma CLI guard).*
