# TOVIS Launch Premortem — 2026-06-24 (second pass)

**Method:** premortem ("it's 3 months post-launch and Tovis is in crisis — why?"). Six parallel investigators re-traced the highest-blast-radius failure domains against the **current** `main` — money/payments, tenant-isolation/PII, booking-integrity/time, auth/abuse, notifications/delivery, deploy/data/ops. This pass does two jobs: **(A) verify which of this morning's Top-12 are actually closed** (reading code, not trusting PR titles), and **(B) hunt new risks**. Every finding carries file:line evidence and a likelihood × blast-radius rating.

**Baseline:** `main` @ `2c80cdec` (post #344–#360).

**Posture:** The morning premortem drove real closure — the load-test kill switch (#360), the BookingHold overlap constraint (#356), the Stripe requeue/reconcile crons (#357/#358), the public-proxy auth gating (#346), the coordinate PII guard (#350), reviewer-PII redaction (#354), the deploy runbook + `.env.example` (#355), and cron `maxDuration` (#353) are all confirmed in the tree and working as described. **What remains is the residue the fixes didn't reach plus a handful of fixes that opened new edges.** Two themes dominate this pass: *partial closure* (the named file got fixed, the class didn't), and *new contradictions introduced by the new invariants* (the hard DB constraint now fights the app's own override policy).

---

## Cross-cutting root causes (this pass)

1. **Closure was per-file, not per-class.** The coordinate leak was fixed on `/api/pros/nearby` but the *same* precise-coord+address leak still ships on the higher-traffic `/api/search/pros`. The UTC-render bug was fixed in `app/pro/clients/[id]` but still lives in `app/pro/reminders` and the reschedule confirm modal. The 404-vs-403 enumeration split was fixed on 3 named paths but survives on the reschedule path. Fixing the instance the audit named, not the pattern it pointed at, is the recurring miss.
2. **New hard invariants now contradict old soft policy.** The unconditional `Booking_no_active_professional_overlap` EXCLUDE constraint directly contradicts `PRO_AUTHORIZED_OVERLAP` / `ADMIN_AUTHORIZED_OVERLAP` — a pro deliberately double-booking now hits an *unhandled* `23P01` → raw 500. The constraint is correct; the policy and the create-path error handling were never reconciled to it.
3. **The dev==prod database is still the master foot-gun.** The Prisma guard (#344) is a speed-bump — raw `npx prisma db push` still bypasses it, and `.env.local`'s `DATABASE_URL` still points at the prod pooler. There is still **no documented backup/PITR/restore posture**. The catastrophe path the morning pass named is materially unchanged.
4. **Stripe-side truth is reconciled for refunds, not for the events that move payouts.** Refund drift now self-heals, but **`charge.dispute.*` is entirely unhandled** and **captured `amount_received` is still never checked against the expected total**. The two money events most likely to produce a wrong payout are the two with no reconciliation.
5. **Silent-dark-subsystem gaps persist at the env edge.** `PII_AEAD_KEYS_JSON` and `DATABASE_URL` are *not* in the boot fail-closed contract; a dropped keyring boots green and throws on the first PII read. The cron-secret precedence (`INTERNAL_JOB_SECRET ?? CRON_SECRET`) can silently 401 the entire money-healing cron layer with no alert.

---

## Top risks this pass (ranked by likelihood × blast)

| # | Risk | Likely? | Blast | Domain | Status |
|---|------|---------|-------|--------|--------|
| 1 | **dev==prod DB root cause unfixed + no backup/PITR/restore posture** — guard is a speed-bump (`npx prisma db push` bypasses it); a wipe has no documented recovery | Med | ☠️ Catastrophic | Ops | Open |
| 2 | **`charge.dispute.*` entirely unhandled** — disputed destination charge claws back the pro + debits platform, but booking still shows SUCCEEDED → wrong payout + double-clawback on later refund | Med | ☠️ Catastrophic | Money | New |
| 3 | **Overlap EXCLUDE constraint contradicts `PRO/ADMIN_AUTHORIZED_OVERLAP`** — authorized double-book hits unhandled `23P01` → raw 500; create-path catches only `P2002` | High | Severe | Booking | New (regression of #356) |
| 4 | **`/api/search/pros` leaks precise lat/lng + street address + placeId** to anonymous callers — the `nearby` leak (#1 this morning), never applied to the higher-traffic search path | High | Severe | Isolation | New |
| 5 | **No amount reconciliation** — `stripeAmountTotal = amount_received` written with no check vs expected total; short/over/wrong-currency capture recorded as truth | Med | Severe | Money | Open (prior #2) |
| 6 | **No provider-level idempotency on SMS/email; only a 60s DB lease** vs an every-minute cron with `maxDuration=60` and serial 250-batches → a >60s drain overlaps and re-sends real billed messages | Med | Severe | Notif | New |
| 7 | **`PII_AEAD_KEYS_JSON`/`DATABASE_URL` not in boot fail-closed contract** — dropped keyring boots green, smoke passes, throws on first allergy/notes/phone read → subsystem silently dark post-deploy | Med | Severe | Ops | New |
| 8 | **No platform fee on main bookings** — deposit PI charges `application_fee_amount`, final-bill + rebook charge $0 platform fee; steady revenue leak if a cut was intended | High | Severe | Money | New (verify intent) |
| 9 | **Cron-secret precedence single point of silent failure** — `INTERNAL_JOB_SECRET ?? CRON_SECRET`; if prod sets a different `INTERNAL_JOB_SECRET`, every Stripe heal cron 401s and all drift-healing stops, no alert | Low | Severe | Money/Ops | New |
| 10 | **`isRoot` host fallback** — any host not exactly matching an active `customDomain` resolves to root = cross-tenant visibility; API path trusts raw `Host`, layout trusts `x-forwarded-host` | Low | ☠️ Catastrophic | Isolation | Open (prior #6) |
| 11 | **Appointment times render in UTC** in `app/pro/reminders/page.tsx:42` (server → UTC on Vercel) and wrong-tz in `ConfirmChangeModal.tsx:46` (reschedule confirm) | High | Moderate | Time | New (class of prior #3) |
| 12 | **Rate limiting still fails OPEN on Redis outage** for all non-`auth-critical` buckets — token brute-force/NFC/holds/finalize unthrottled exactly under stress | Med | Severe | Auth | Open (accepted) |

**Honorable mentions:** migrate-on-deploy still forward-only & build-coupled (revert leaves new schema under old code); `upload-sessions/cleanup` cron is built+authed but **not in `vercel.json`** → orphaned signed PII media never reaped; `scheduleTransaction.ts:55` still throws `FORBIDDEN` (404-vs-403 enumeration survives on reschedule); refund crash-window orphan PENDING rows with null `stripeRefundId` no sweep settles; `APPOINTMENT_REMINDER` quiet-hours defer can post-date a same-morning reminder; null recipient timezone *disables* quiet hours entirely (TCPA exposure) rather than failing safe; spoofable proof IP/UA persisted as consent evidence on the consultation decision route; Postmark webhook secret compared with `===` not timing-safe; `DIRECT_URL` (migrate path) points at the session pooler not a true direct endpoint; no `connection_limit` on the pooled URL under serverless fan-out; plaintext-PII baseline grew to **584** entries with no burn-down.

---

## Domain detail & evidence

### 💸 Money / payments
**Closure:** #1 dashboard-refund double-refund **CLOSED** (`refunds.ts:177-188,551-560` folds Stripe's `stripeAmountRefunded` into reservation math); #3 reverse_transfer fee math **CLOSED** (correct for zero-fee model); #4 out-of-order `payment_failed` downgrade **CLOSED** (`writeBoundary.ts:14272-14292` `wouldDowngradeCaptured`); #6 webhook requeue **CLOSED** (`requeueFailedWebhookEvents.ts` replays all failed events); #5 client idempotency **materially mitigated** (nonce on gated checkout + server ledger guard); #2 amount reconciliation **STILL OPEN**; #7 refund split-transaction **PARTIAL** (booking-level heals, orphan rows don't).

- **N2 — `charge.dispute.*` unhandled.** `handleWebhookEvent.ts:404-468` switch has no dispute cases; `StripePaymentStatus.DISPUTED` is only ever *read* (`writeBoundary.ts:14275`), never written. A later refund on an already-clawed-back charge errors or double-claws the pro. **Med · Catastrophic.**
- **N1 — No platform fee on main bookings.** Deposit sets `application_fee_amount` (`deposit/stripe-session/route.ts:159`); final-bill (`checkout/stripe-session/route.ts:230-232`) and rebook (`rebook/[token]/checkout/route.ts:218-220`) set only `transfer_data.destination`. **High · Severe** (revenue leak if a cut was intended — verify product intent).
- **Item 2 — No amount reconciliation.** `writeBoundary.ts:14177-14178` writes `stripeAmountTotal: amountReceivedCents` with no compare to the prepared `amountCents` (`:13487`). **Med · Severe.**
- **N6 — Cron-secret precedence.** `internalJob.ts:9-11,22-28` prefers `INTERNAL_JOB_SECRET`; Vercel cron carries only `CRON_SECRET`. Divergent values → all 3 Stripe crons 401 silently. **Low · Severe.**
- **N4 — Orphan-recovery vs live-webhook dup apply.** Different `stripeEventId`s (`orphan_recovery:<session>` vs real id) → second arrival re-runs the booking update (idempotent values, status-guarded closeout, so no money loss — correctness smell). **Med · Moderate.**
- **N3 — Refund crash-window orphan.** `reserveRefund` row whose Stripe call succeeded but `settleSucceededRefund` crashed keeps null `stripeRefundId`; reconcile settles only by `stripeRefundId` (`refunds.ts:562-564`) → stranded PENDING permanently reserving headroom. **Low · Moderate.**
- **N5 — Partial deposit refund mis-modeled.** `reconcileDepositChargeRefundInTransaction` sets `depositStatus: REFUNDED` on *any* amount (`writeBoundary.ts:14031-14043`); later `refundDiscoveryDeposit` no-ops on non-PAID. **Low · Moderate.**

> Single highest-value money fix: handle `charge.dispute.*` (write DISPUTED, freeze refund path) and add the captured-vs-expected amount check — closes the two unreconciled payout vectors.

### 🔒 Tenant isolation / PII
**Closure:** #1 `nearby` coord/address **CLOSED** (`nearbyPros.ts:79-111` strips address, coarsens to 2 decimals); #2 lat/lng in PII guard **CLOSED** (`check-pii-plaintext-reads.mjs:118`); #3 reviewer name/email **CLOSED** (`publicProfileFormatting.ts:262-274` "Jane D.", no email); #4 enumeration **PARTIAL** (3 named paths fixed; `scheduleTransaction.ts:54-55` still 403); #5 plaintext-PII baseline **OPEN** (grew to 584); #6 `isRoot` host fallback **OPEN**.

- **New #1 — `/api/search/pros` leaks precise coords + address.** `lib/search/pros.ts:145-156` passes `formattedAddress`, `placeId`, raw `lat`/`lng` into the public DTO; `route.ts:16-24` returns it unauthenticated, uncoarsened — the exact class #1 fixed on `nearby`. **High · Severe.**
- **Item 6 — `isRoot` fallback.** `resolveTenant.ts:126-140` resolves root for any host not matching an active `customDomain`; `visibility.ts:26-70` returns `{}`/TRUE for root → cross-tenant. **Low · Catastrophic.**
- **New #3 — Host-trust inconsistency.** `requestContext.ts:18` trusts raw `Host`; `layoutContext.ts:30-31` trusts `x-forwarded-host`. Combined with the root fallback, a spoofed/misrouted host can land in the wrong tenant. **Low · Severe** (confirm edge strips client `Host`).
- **Item 4 residual — `scheduleTransaction.ts:55`** throws `FORBIDDEN` for non-owned (vs `BOOKING_NOT_FOUND` for missing) → enumeration oracle on reschedule. **Med · Moderate.**
- **New #2 — `/api/search/services` no tenant filter** (cross-tenant catalog read, low PII). **Med · Low.**
- **New #4 — Postmark webhook secret `===`** (`webhooks/postmark.ts:116,122,129`), not timing-safe. **Low · Moderate.**
- **New #5 — Consultation magic-link returns `proof.ipAddress`/`userAgent`/`recordedByUserId`/counterparty contact** (`public/consultation/[token]/route.ts:220-238`). **Low · Moderate.**

> Verified clean: admin moderation gated; all internal cron routes timing-safe; `pro-license/verify` authed + raw payload stripped; Google geocode rate-limited; looks/availability surfaces coarse-only.

### 📅 Booking integrity / time
**Closure:** #2 BookingHold overlap constraint **CLOSED** (`20260624010000_add_booking_hold_overlap_exclusion`, hold catch at `writeBoundary.ts:6896-6933`); #5 holds self-delete **CLOSED** (under lock + DB backstop); #6 DST display **largely CLOSED** (round-trip + wall-time probe in day math); #1 UTC render **PARTIAL** (named file fixed, class survives — see N2); #3 invariant test **PARTIAL** (tests two JS builders against each other, not the SQL function or the runtime query path); #4 reschedule/finalize idempotency **PARTIAL**.

- **N1 — EXCLUDE constraint vs override policy.** `overlapPolicy.ts:161-175` grants authorized overlap; `Booking_no_active_professional_overlap` is unconditional; all three create catches (`writeBoundary.ts:8484,~8946,~9512`) handle only `P2002` then `throw` → authorized double-book = unhandled `23P01` 500. Also turns a create/finalize race into a 500 instead of `TIME_NOT_AVAILABLE`. **High · Severe.**
- **N2 — UTC/wrong-tz appointment renders.** `app/pro/reminders/page.tsx:42` (server `toLocaleString` no `timeZone` → UTC on Vercel); `ConfirmChangeModal.tsx:46` (reschedule confirm renders viewer tz not `locationTimeZone`). **High · Moderate.**
- **N3 — Three divergent busy-window definitions** for the same hold: SQL `tovis_booking_overlap_range` (`GREATEST(1,…)`), JS `holdToBusyInterval` (clamp, NULL→60), runtime `calculateWindowEnd` (NULL→0). Agree for clean data; a NULL/odd snapshot diverges, and the invariant test covers none of the three against each other. **Low · Moderate.**
- **N4 — `cleanupAllExpiredHolds`** read+delete outside lock (`writeBoundary.ts:14641-14661`) → brief cache staleness only; inline per-pro delete under lock prevents correctness impact. **Low · Low.**

> Verified solid: per-pro advisory lock + lock-then-reload on every schedule mutation; both EXCLUDE constraints share `btree_gist`/`tovis_booking_overlap_range`; conflict lookback `−900min` covers max window; availability math DST-correct.

### 📨 Notifications / delivery
**Closure:** #1 kill switch **CLOSED** and fail-safe (`loadTestDelivery.ts` default-off + hard-fenced off prod via `VERCEL_ENV`, gates both `sendSms.ts:258` and `sendEmail.ts:372`); #2 BOOKING_CONFIRMED **CLOSED** (`eventKeys.ts:152,155` bypass + emailAlwaysOn); #5 orchestration-failure retry **CLOSED** (`processDueDeliveries.ts:243-324` backoff); #6 zero-channel **mitigated** (defer not drop); #3 APPOINTMENT_REMINDER **OPEN**; #4 no-code Twilio throw → retryable **OPEN**; #7 SMS consent gate **OPEN** (intentional TCPA default).

- **N1 — No provider idempotency; 60s lease vs every-minute cron.** `idempotencyKey` is internal-only (not sent to Twilio `messages.create` `sendSms.ts:282`, only Postmark `Metadata` `sendEmail.ts:396-404`); lease is 60s (`claimDeliveries.ts:18`); cron is `* * * * *` with `maxDuration=60` and serial 250-batch (`processDueDeliveries.ts:498-507`). A >60s drain → lease expiry → concurrent reclaim re-sends a real billed message. **Med · Severe.**
- **N3 — Process cron has no overlap singleton** (`process/route.ts:12` `maxDuration=60`, every 60s) → overlapping drains in exactly the N1 window. **Med · Moderate.**
- **N5 — Null recipient timezone disables quiet hours.** `channelPolicy.ts:187,349,374` → null local-minutes → `isWithinQuietHours` false → SMS can fire at 3am for clients with no captured tz (common for unclaimed/phone-only). **Med · Low-Moderate** (TCPA-adjacent; default to booking-location tz).
- **N4 — Recovery backlog burst** — stalled cron → all PENDING become due at once → serial 250/batch burst, no provider rate limiting. **Low · Moderate.**
- **Item 3 — APPOINTMENT_REMINDER** (`eventKeys.ts:333` no bypass) → same-morning reminder for an 07:00 appt defers to 08:00, after the appt. **Med · Moderate.**
- **Item 4 / N6 — no-code Twilio/Postmark throw → retryable** (`providerStatus.ts`, `sendEmail.ts:124-147`), bounded by maxAttempts. **Med/Low · Low.**

### 🛡️ Auth / abuse
**Closure:** #1 `pro-license/verify` **CLOSED** (authed + per-user limit + raw stripped, `route.ts:217-229,342-366`); #2 Google proxies **CLOSED** (all 4 rate-limited, bucket wired; still anon by design); #7 NFC tap **CLOSED** (limit before mint, bot-skip); #4 login captcha **OPEN** (defended by IP limit + lockout + timing equalization); #3 rate-limit fail-open **OPEN** (by design); #5 token endpoints **PARTIAL/acceptable**; #6 consultation GET IP/UA **OPEN**. Bonus: Turnstile now hard-blocked from fail-open on deployed runtime; Stripe webhook sig + idempotency solid.

- **New #2 — Spoofable proof IP/UA on consultation decision route.** `decision/route.ts:111-119` reads raw `x-forwarded-for`/`x-real-ip` (not the trusted-IP resolver) and stores them as consent "proof" → forgeable audit trail. **Med · Moderate.**
- **New #3 — `account-invite` claim-link mint has no rate limit** (`public/account-invite/[token]/route.ts:18-49`); token-gated but the only public POST with no limiter. **Low · Low-Moderate.**
- **New #4 — Unset `AUTH_TRUSTED_IP_HEADER` collapses all IP limiters to one `ip:'unknown'` bucket** (`trustedClientIp.ts:87-89`, `rateLimit.ts:179-182`) → global shared quota (DoS, not bypass); mitigated by fatal Sentry alert. **Low · Medium.**

> Verified clean: all internal cron routes timing-safe + fail-closed; privacy routes ADMIN+SUPER_ADMIN gated; Postmark/Twilio webhooks signature-verified; cookie auth `SameSite=lax` blocks CSRF.

### ⚙️ Deploy / data / ops
**Closure:** #2 deploy/rollback runbook **CLOSED** (`docs/runbooks/deploy-and-rollback.md`); #4 cron `maxDuration` **CLOSED** (all 15); #5 `.env.example` **PARTIAL** (exists, but boot contract omits AEAD/DB — see N1); #1 dev==prod guard **PARTIAL** (host-detect works, raw `db push` bypasses, root cause unfixed); #3 forward-only migrate **OPEN** (documented); #6 single-region **OPEN** (accepted); #7 connection fan-out **OPEN**.

- **N2 — No backup/PITR/RPO-RTO posture anywhere.** `postgres-outage.md` covers degraded mode but no backup cadence/retention/restore procedure; combined with #1 a wipe has no tested recovery. **Low · Catastrophic.**
- **N1 — `PII_AEAD_KEYS_JSON`/`DATABASE_URL` not boot-validated.** `startupEnvValidation.ts:25-44` covers Sentry/cron-secret/Postmark only; AEAD read lazily (`aead.ts:37`) → dropped keyring boots green, throws on first PII op. **Med · Severe.**
- **N3 — `upload-sessions/cleanup` cron never scheduled** (route exists+authed, not in `vercel.json`, POST-only/no `maxDuration`) → orphaned signed-but-unattached PII media never reaped. **High · Low-Medium.**
- **N5 — No `connection_limit` on pooled URL** under serverless fan-out (`?pgbouncer=true` only); read replica unconfigured → all reads on one pool. **Med · Med-High.**
- **N4 — `DIRECT_URL` points at the session pooler**, not a true direct endpoint; migrate/advisory-locks over a pooler can hang (memory already notes "migrate diff hangs on pooler") → stalled `migrate deploy` blocks the build. **Med · Medium.**

---

## Fix-first shortlist

1. **Handle `charge.dispute.*`** (#2) — write `DISPUTED`, freeze the refund path on disputed charges; this is the top unreconciled payout vector. Pair with the **captured-vs-expected amount check** (#5) — both are one webhook/reconcile change.
2. **Reconcile the overlap constraint with the override policy** (#3) — either make the EXCLUDE predicate override-aware, or (if pros may not overlap) drop the policy and map `23P01` → `TIME_NOT_AVAILABLE` in all three create catches. Today it's a guaranteed 500.
3. **Coarsen `/api/search/pros`** (#4) — apply the same `coarsenPublicCoordinate` + null `formattedAddress`/`placeId` already used on `nearby`, in `lib/search/pros.ts:mapLocationPreview`.
4. **Close the dev==prod root cause** (#1) — make `.env.local`'s default `DATABASE_URL` a *local* DB, not the prod pooler; document and test a restore path (N2). The guard is a speed-bump, not the fix.
5. **Add `PII_AEAD_KEYS_JSON` + `DATABASE_URL` to the boot fail-closed contract** (#7) and assert `INTERNAL_JOB_SECRET == CRON_SECRET` (or alert when only one is set) so the money-healing crons can't 401 silently (#9).
6. **Give notification sends a provider idempotency key** and/or widen the lease beyond the cron period + add a drain singleton (#6) — the most plausible path to a surprise Twilio/Postmark bill.
7. **Finish the per-class fixes the per-file pass missed:** UTC render in `app/pro/reminders` + `ConfirmChangeModal` (#11), `scheduleTransaction.ts:55` → `BOOKING_NOT_FOUND`, schedule the `upload-sessions/cleanup` cron, default null-tz quiet-hours to the booking-location zone.
8. **Decide the platform-fee question** (#8) — confirm whether $0 fee on main bookings is intended before scale makes the leak material.

---

*Read-only premortem across the repo; no files were modified. Companion to `premortem-2026-06-24.md` (morning pass) — this pass verifies its closures and extends the findings against current `main`.*
