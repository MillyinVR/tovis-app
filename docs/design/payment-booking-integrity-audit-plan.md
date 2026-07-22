# Payment ↔ booking integrity audit — plan & card queue

**Planned:** 2026-07-22 · **Scope:** `tovis-app` + `tovis-ios`
**Question to answer:** once a booking exists, can its money state and its
booking state ever disagree — a wrong charge, an eaten refund, a payment the
ledger never saw, or a surface that lies about any of those to the client or
the pro?

This is the successor to the scheduling-conflict audit
(`scheduling-conflict-audit-fix-plan.md`, F1–F16, re-audited clean 2026-07-22).
That audit proved the client can never *see* an unbookable slot; this one is
about what happens to the money after they book it.

**Provenance discipline.** Every claim in §0–§2 marked **VERIFIED** comes from a
source read done while planning (2026-07-22, line numbers as of `main` @
`226ab4b6`). Claims marked **UNVERIFIED** are inferences or sub-agent code-reads
that each card's session must confirm before fixing — the F-series lesson
applies: *a card's premise is a claim to verify, not a fact* (ten of nineteen
round-3 premises died on contact with the code). No iOS surface has been
driven; no Stripe interleaving has been driven. Nothing in this doc has shipped.

---

## 0. How the money paths are structured today (VERIFIED)

Read this before assuming a card's bug is real — much of the obvious risk is
already engineered away, and the queue below deliberately targets what is NOT.

**Ordering is universally book-then-charge.** The write boundary
(`lib/booking/writeBoundary.ts`) is DB-only; every external Stripe effect runs
post-commit at the route layer (checkout session creation, refunds,
notification sends). Two charge timings exist
(`PaymentCollectionTiming`): the new-client **discovery deposit** (charged at
booking time, its own PaymentIntent carrying the platform fee) and the
**service payment** (closeout-time; Stripe card, or manual
mark-paid / confirm-received / waive).

**Layers that already exist and work (do not re-litigate):**

- **Webhook spine** — `app/api/webhooks/stripe/route.ts`: signature check →
  `StripeWebhookEvent` row with unique `stripeEventId` + `processedAt`
  short-circuit → ONE `$transaction` (30s) running
  `lib/stripe/handleWebhookEvent.ts` → on throw, `failedAt` + `lastError`
  persisted with the full payload.
- **Three healing crons** — `stripe-webhook-requeue` (*/15, replays
  `failedAt`-stamped events through the same `handleStripeEvent`),
  `stripe-orphan-recovery` (*/10, finds paid-at-Stripe-but-not-locally bookings
  30min–72h old and re-drives `applyStripePaymentSucceeded`),
  `stripe-reconciliation` (hourly, 45-day window: refund drift on final-bill +
  deposit PIs, captured-amount drift alerting, PENDING `BookingRefund`
  settling).
- **Refund owner** — `lib/booking/refunds.ts`: per-booking advisory lock
  (namespace 41022, distinct from the 41021 schedule lock), reserve-then-call
  pattern (PENDING row before the Stripe call, Stripe idempotency key derived
  from the row id), remaining-amount math that counts Dashboard/external
  refunds via monotonic `stripeAmountRefunded`, crash recovery that re-adopts
  a reserved-but-unsettled row from refund metadata (N3), dispute freeze
  (DISPUTED refuses automated refunds until the dispute resolves).
- **Out-of-order webhook armor** — `payment_intent.payment_failed` never
  downgrades a captured status; a replayed `payment_intent.succeeded` dedupes
  on the booking's terminal STATE (not event id), so live webhook, requeue and
  orphan recovery converge; a stale success can never un-DISPUTE; a won
  dispute only restores a booking still marked DISPUTED.
- **Cancel-refund policy** — `lib/booking/cancelRefund.ts`, single policy home
  `isAutoCancelRefundEligible`: admin always / pro never / client only ≥24h
  out — service payment only; the discovery deposit has its own deliberate
  policy (`resolveDepositRefundPlan`) where a pro cancel refunds deposit+fee.
  Both helpers are best-effort post-commit: a refund failure can never fail a
  committed cancel.

**The shape of the remaining risk** is therefore not "no defenses" but the
F13/F16 shape: the paths the defenses *exempt* (CANCELLED bookings, non-final
deposit sessions, FAILED refund rows) and the places where the DB's opinion is
shown as if it were Stripe's.

---

## 1. Money-event × guard matrix

Every write that moves or records money, against the guards it runs under.
✅ verified present · ❌ verified absent · ❓ audit must determine.

| # | Money event | Entry | Booking-status guard | Idempotency | Reconciler coverage |
| --- | --- | --- | --- | --- | --- |
| 1 | Deposit checkout prepared | `POST /client/bookings/[id]/deposit/stripe-session` | ✅ refuses CANCELLED (`:16004`) | ✅ route + Stripe key | n/a |
| 2 | Deposit marked PAID | webhook / `applyStripeDepositSucceededInTransaction` (`:16092`) | ❌ **none** — pays a CANCELLED booking | ✅ deposit-status state | ❌ no sweep looks for paid-deposit-on-cancelled |
| 3 | Deposit session EXPIRED | webhook `checkout.session.expired` | ❌ **mis-routed** — falls into the FINAL-BILL field writer (M2) | — | ❌ |
| 4 | Service payment SUCCEEDED | webhook / orphan-recovery / requeue → `performLockedApplyStripePaymentSucceeded` (`:16269`) | ❌ **none** — pays a CANCELLED booking (M1) | ✅ terminal-state dedupe | ⚠️ orphan sweep **excludes CANCELLED + COMPLETED** (`stripe-orphan-recovery/route.ts:224`) |
| 5 | Service payment FAILED | webhook (`:16447`) | ✅ never downgrades captured | ✅ event id + status | ✅ |
| 6 | `charge.refunded` (final bill) | webhook + hourly sweep → `reconcileChargeRefundInTransaction` | n/a | ✅ monotonic max + per-refund-id notification dedupe | ⚠️ hourly sweep drops refund `metadata.bookingRefundId` → N3 recovery only works via live webhook (M7) |
| 7 | `charge.refunded` (deposit PI) | webhook + sweep → `reconcileDepositChargeRefundInTransaction` (`:16144`) | n/a | ✅ monotonic max, N5 partials | ✅ |
| 8 | Dispute open/won/lost | webhook → `applyStripeDisputeInTransaction` | ✅ won-restore guarded | ✅ | ❓ **deposit-PI disputes appear unmatched** (M4) |
| 9 | Auto cancel refund (service) | cancel routes → `applyAutoCancelRefund` | keyed on `cancelMutated` | ✅ Stripe key per row | ❌ **FAILED rows: nothing retries** (M3) |
| 10 | Auto cancel refund (deposit) | cancel routes → `applyDiscoveryDepositCancelRefund` | keyed on `cancelMutated` + `depositStatus=PAID` — ⚠️ PENDING-at-cancel = skipped forever (M1) | ✅ cumulative-carrying key | ❌ same |
| 11 | Manual closeout: mark-paid / waive | `POST /pro/bookings/[id]/checkout/{mark-paid,waive}` (`:13857`, `:13964`) | ❓ "from any pre-collection state" — can it stomp a Stripe PAID? (M9) | ✅ route | n/a |
| 12 | Off-platform confirm | `.../confirm-payment` (`:13895`) | ✅ refuses non-AWAITING_CONFIRMATION | ✅ | n/a |
| 13 | No-show / late-cancel fee | `assessAndChargeNoShowFee` | gated `ENABLE_NO_SHOW_PROTECTION` (dark) | ❓ | ❓ (M12) |
| 14 | Booking auto-COMPLETED by payment | `maybeCompleteBookingCloseout` (`:2698`) from webhook/manual closeout | ❓ via `canCompleteBookingCloseout` — verify CANCELLED/NO_SHOW can't complete (M8) | — | — |

---

## 2. Audit card queue

Ordered by risk. Each card: verify the premise first, then drive the real
interleaving (Stripe test mode or stubbed webhook POSTs against local), then
fix, then test. One PR per card unless noted. The standing rules apply hard
here: *don't guess — drive it*; *a refusal after a write must throw, not
return*; *green tests, wrong artifact* — assert on what reaches the wire.

### M1 — Pay → cancel → webhook: money lands on a CANCELLED booking, nothing refunds it 🔴

**Premise (VERIFIED, not yet driven).** Neither
`performLockedApplyStripePaymentSucceeded` (`writeBoundary.ts:16269`) nor
`applyStripeDepositSucceededInTransaction` (`:16092`) checks `booking.status`.
The cancel-side refund helpers skip when the payment hasn't landed *locally*
yet (`PAYMENT_NOT_CAPTURED` / `depositStatus !== PAID`). The orphan sweep
excludes CANCELLED. The reconciliation sweep only heals *refund* drift on
already-recorded payments — it has no concept of "captured money on a
cancelled booking with no refund".

**The interleaving to drive** (deposit flavor is the reachable one — the
deposit charges at booking time while the booking is client-cancellable):

1. Client books (new client → deposit PENDING), completes Stripe checkout.
2. Before the webhook lands (delay/outage — or just hold the event), client
   cancels. `applyDiscoveryDepositCancelRefund` → `NOT_ATTEMPTED`
   (deposit still PENDING).
3. Webhook (or requeue) lands: deposit flips PAID on the CANCELLED booking.
4. **End state to disprove:** client cancelled ≥24h out, policy says full
   deposit refund, client is out the money, no alert fires, no sweep ever
   revisits it. Same shape for the service payment via the requeue cron
   replaying a stale `payment_intent.succeeded` after an admin cancel.

**Fix direction** (decide after driving): the late-arriving success handler is
the one place that KNOWS both facts ("money captured" + "booking already
CANCELLED") — it should either trigger the same policy-driven refund the
cancel would have issued, or emit a first-class alert/queue row a human must
clear. Widening the orphan sweep to CANCELLED without a refund action just
records the problem harder. Mind the standing rule: the promise site must run
the commit site's gate — reuse `isAutoCancelRefundEligible` /
`resolveDepositRefundPlan`, do not re-derive policy in the webhook layer.

**Tests.** Integration: cancel-then-apply for both PIs × both eligibility
sides of the 24h line; requeue replay after cancel; assert a refund row (or
alert) exists at the end, not merely a PAID flag.

### M2 — Expired deposit checkout session poisons the FINAL-BILL payment fields 🔴

**Premise (VERIFIED, not yet driven).** `handleCheckoutSession`
(`lib/stripe/handleWebhookEvent.ts:122`) routes a deposit session to the
deposit handler **only when `status === COMPLETE`**. The deposit session
carries `metadata.bookingId` + `client_reference_id`
(`deposit/stripe-session/route.ts:121–168`), so on `checkout.session.expired`
the event falls through to `applyStripeCheckoutSessionStatusInTransaction`,
which resolves the booking **by that hint** (`findBookingForStripeWebhook`
prefers the hint, `:16232`) and stamps the DEPOSIT session's id, PI id and
amounts into the **final-bill** fields — `stripeCheckoutSessionId`,
`stripePaymentIntentId`, `stripeAmountTotal`, plus
`paymentProvider=STRIPE` / `selectedPaymentMethod=STRIPE_CARD`
(`:16625–16642`).

**Blast radius to map when driving:** a booking that never chose card now
claims Stripe; the orphan sweep's candidate filter (`stripeCheckoutSessionId
not null`) now matches and interrogates the *deposit* session's
payment status against the *final bill*; a later real service checkout
overwrites some fields but the interim reads lied. Stripe fires
`checkout.session.expired` for abandoned sessions (default 24h), so this is a
routine path, not an exotic one.

**Fix direction.** Route on the session's *kind*, not its status:
`isDiscoveryDepositMetadata` should divert **every** status — COMPLETE to the
paid handler, EXPIRED to a (new, small) deposit-session-expired handler that
touches only deposit fields (or deliberately nothing) — so a deposit session
can never reach the final-bill writer. This is the one-code-two-meanings rule
in webhook form.

**Tests.** Handler-level: expired deposit session leaves every final-bill
field untouched; expired *final-bill* session still records EXPIRED.

### M3 — A FAILED refund is a dead end: no retry, no surface, silent client 🔴

**Premise (VERIFIED structure; surfaces UNVERIFIED).** `refundBookingPayment`
marks the reserved row FAILED + Sentry and returns — by design, the cancel is
already committed. But: the hourly sweep settles **PENDING** rows only (FAILED
rows are terminal to it); no cron re-drives FAILED rows;
`refundDiscoveryDeposit` rolls its reservation back on failure (with a
swallowed `.catch(() => {})` on the rollback itself — a double-fault strands
the counter) and returns FAILED to a caller that discards it. The cancel
response body (`cancel/route.ts:131`) carries **no refund outcome at all**.

**Audit questions.** (a) Enumerate every surface where a FAILED/PENDING
`BookingRefund` becomes visible to a human — money-trail? pro UI? admin?
nothing-but-Sentry? (b) Is there any discretionary refund endpoint a pro/admin
can use as the manual retry, and does it handle the FAILED row's reserved
history correctly? (c) What does the client see between "cancelled" and
"refunded" — and forever, if it failed?

**Fix direction.** A FAILED auto-refund needs an owner: either a bounded
retry sweep (FAILED → re-drive through `refundBookingPayment`, which is
already idempotent per-row) or a first-class "needs attention" surface for
the pro/admin — plus M6's honesty work so the client isn't told a lie by
omission. Cron-populated-signal honesty applies: never render "refunded" from
a row that says FAILED.

### M4 — A dispute on the DEPOSIT PaymentIntent matches no booking 🟠

**Premise (VERIFIED code path; UNVERIFIED end-to-end).**
`handleChargeDispute` resolves by `dispute.payment_intent` through
`findBookingForStripeWebhook`, which searches `stripePaymentIntentId` (the
final-bill field) and the hint — dispute events carry no bookingId metadata.
A deposit dispute (`depositStripePaymentIntentId`) therefore returns
`handled:false`: **no freeze, no alert**, while Stripe pulls the funds. The
deposit refund path would then happily double-return the money
(`refundDiscoveryDeposit` checks `depositStatus`, not a dispute flag).

**Audit.** Confirm by constructing the event against local; check whether
`charge.refunded`'s deposit reconcile accidentally absorbs the
funds-withdrawal (it should not — a dispute is not a refund). Decide the
minimal correct model: match deposit PIs in the dispute handler, record a
deposit-dispute state that freezes `refundDiscoveryDeposit`, and alert
(`captureStripeDisputeAlert` already exists — reuse, distinct log identity).

### M5 — An abandoned deposit checkout squats the pro's calendar forever 🟠

**Premise (VERIFIED absence).** The booking is created PENDING with
`depositStatus=PENDING` *before* checkout; it occupies the schedule (PENDING
is an occupying status, by design — that's F14's reservation working). No cron
touches `depositStatus`; nothing expires an unpaid-deposit booking
(`stale-sessions` is telemetry-only by explicit design). If the client walks
away from the Stripe page, the slot is dead until the pro manually notices
and cancels.

**Audit.** (a) Pin the actual window: what does the pro SEE for such a
booking (web + iOS) — does anything say "deposit unpaid"? (b) What does the
CLIENT see/receive — a payment nudge, or silence? (c) Then the policy
decision — likely **Tori's call**: auto-cancel on `checkout.session.expired`
for the deposit session (natural companion to M2's new expired-deposit
handler), a shorter explicit deposit deadline, or a loud pro-facing surface
with one-tap cancel. The pro-chosen-time rule cuts BOTH ways here: the
reservation is the feature working, but a reservation nobody will ever pay
for needs a surface (reserving-a-slot-needs-a-surface) and an exit.

### M6 — Cancel-time money honesty: what each platform tells the client vs what happened 🟠

**Premise (VERIFIED server side).** The cancel route runs refund + deposit
refund + (dark) late-cancel fee, then returns a body with **no refund
information**; both refund helpers' outcomes are discarded. Success-side
receipts exist (`emitPaymentRefundedNotifications`, deduped per refund id) —
but the FORFEITED, FAILED and NOT_ATTEMPTED outcomes produce nothing.

**Audit.** Read both platforms' cancel flows end-to-end: pre-cancel copy (is
the ≥24h/<24h policy shown before the client commits? the deposit forfeit?),
post-cancel state (does the UI claim a refund is coming when the row says
FAILED?), and the notification copy for each `BOOKING_CANCELLED_BY_*` key.
Wire the truthful outcome into the response and/or notifications. iOS drives
the same cancel endpoint (`BookingDetailView.swift`, `ContentView.swift`) —
whatever the response gains, iOS must render or deliberately ignore; land the
two sides together per house cadence.

### M7 — Reconciler coverage matrix: what drift class does each sweep actually catch? 🟠

**Premise (mixed).** Verified facts to build on: orphan recovery window
30min–72h, cap 200, **excludes CANCELLED and COMPLETED**; reconciliation
window 45 days, cap 150 (`capped` surfaced honestly); requeue replays only
events that got as far as a `failedAt` stamp (a webhook that never arrived
has no row — that's the orphan sweep's job); the hourly sweep's
`refunds.list` mapping **omits `metadata.bookingRefundId`**
(`stripeReconciliation.ts:234`) so the N3 stranded-PENDING-row recovery only
works when the live `charge.refunded` webhook arrives — the sweep that
exists to cover lost webhooks can't do the recovery the webhook can.

**Audit.** Enumerate the drift classes (lost success webhook × booking
status; lost refund webhook × row state; session created but
`recordStripeCheckoutSessionAttached` never ran — crash window between
Stripe-create and DB-record; captured-amount drift) and map each to the
sweep that heals it, on what delay, with what cap. Fix the cheap holes found
on the way (the `bookingRefundId` pass-through is a two-line fix); file the
policy-sized ones as their own cards. Deliverable: a table in this doc, F-series
§1 style, so the next person doesn't re-derive it.

### M8 — The lifecycle-contract bypasses: every status write that skips `assertLegalStatusTransition` 🟠

**Premise (partially VERIFIED).** The webhook payment appliers mutate payment
fields (legitimately outside the status machine) but one of them can flip
**status**: `maybeCompleteBookingCloseout` (`:2698`) COMPLETEs a booking as
SYSTEM when payment + aftercare + after-media line up, guarded by
`canCompleteBookingCloseout` — whose status predicate this plan did NOT read
(UNVERIFIED whether a CANCELLED/NO_SHOW booking with late-arriving payment
can be dragged to COMPLETED; interacts directly with M1).
`cancelImportedBookingIfPristine` (`:14203`) does a lock-less `updateMany`
status write. The migration-import cancel and any other `updateMany` status
writes inside the boundary need the same enumeration F8 gave the occupied
statuses.

**Audit.** Grep the boundary for every `status:` write; for each, name the
guard that makes it legal (contract call, state predicate, or a documented
exemption) — then close whichever has none. Verify specifically:
payment-succeeded on CANCELLED cannot complete (ties to M1's fix);
`recordStatusTransition` telemetry fires on ALL of them so the observability
backstops (#724) see SYSTEM transitions too.

### M9 — Manual closeout guards: can mark-paid stomp a live Stripe payment? 🟡

**Premise (UNVERIFIED).** `markProBookingCheckoutPaid` is documented as
recording a manual collect "from any pre-collection state"; the state
predicate lives in `performLockedUpdateProCheckoutCloseout` (`:12364`),
unread. The interleaving to check: client's Stripe checkout session is live
(or PI already succeeded but webhook pending) while the pro marks cash/waives
— do we end with double collection (card capture + cash) or a WAIVED booking
that Stripe then pays? What un-does a mistaken mark-paid/waive, and does the
audit log (`BookingCloseoutAuditLog`) capture enough to reconstruct?

**Audit.** Read the predicate, drive the two races (mark-paid vs
late-succeeding PI; waive vs live session), pin refusal-vs-last-write
semantics deliberately, and give whichever side loses a distinct error code
per the one-code-two-meanings rule.

### M10 — Deposit-plan consistency across every booking-creation path 🟡

**Premise (UNVERIFIED).** The discovery-deposit plan is resolved at
finalize (`resolveDiscoveryFinalize.ts`). The other SIX creation paths
(pro-create, consultation materialization, pro rebook, client aftercare
rebook, aftercare-next confirm, waitlist-offer confirm) each either apply the
same new-client deposit policy, deliberately skip it, or accidentally skip
it — this plan does not know which. A new client acquired via waitlist offer
who owes no deposit while the same client via search owes one is a policy
hole; the drifted-duplicate rule applies (name the question each path
answers BEFORE aligning them — some skips may be deliberate:
a pro-created booking plausibly shouldn't charge the pro's own walk-in a
discovery fee).

**Audit.** Table: creation path × does it resolve the deposit plan × is that
deliberate (find the decision or ask Tori). Fix drift; document deliberate
divergence inline where each path skips it. Also re-check the three
hand-rolled `$transaction` + inline `lockProfessionalSchedule` creation fns
(`:13306`, `:14315`, `:14437`) match the `withLocked*` wrappers' tx options —
they were flagged by the code-map as structural variance.

### M11 — Money display truth on both platforms 🟡

**Premise (UNVERIFIED — pure read-side, do LAST of the code cards).** Every
badge derived from `checkoutStatus` / `depositStatus` /
`stripePaymentStatus` / `BookingRefund` on web (client bookings, pro
closeout, money-trail) and iOS (`ProMoneyTrailView.swift`, checkout,
booking detail): does each render the DB's opinion where Stripe's differs
(M1/M2 outputs), and does any surface show "paid/refunded" from a field a
FAILED row contradicts? The display-check-on-a-write-path rule applies in
reverse: fix displays by fixing the data they read (M1–M7), then verify the
surfaces — in the simulator / browser, not by reading JSX (green tests,
wrong artifact).

### M12 — No-show & late-cancel fee: dark-launch readiness 🟡

**Premise (VERIFIED gating; internals UNVERIFIED).** Everything is behind
`ENABLE_NO_SHOW_PROTECTION` (off; BACKLOG §7 holds it). Before Tori ever
flips it: read `lib/noShowProtection/charge.ts` + `fee.ts` against this
audit's standards (idempotency of the fee charge, refund interaction, the
`priorStatus` capture in the cancel route — note it reads status BEFORE the
cancel outside the cancel's transaction, a read-then-write gap), and add the
missing fee-charge e2e (the code-map found none). Deliverable: a go/no-go
checklist in this doc, not a flag flip — the flip stays Tori's.

### M13 — Test-gap closure & the money-path suite 🟢

Runs threaded through M1–M12, then one closing pass: dispute handlers get
direct tests (thinnest coverage of the webhook family), refund concurrency
gets an integration test in the F11 style (two concurrent cancels, cancel
vs Dashboard refund), and the webhook route's tests pin the **wire** shapes
from verbatim Stripe captures, not hand-built mocks
(wire-shape-vs-mock-drift). Wire the new suites into CI visibly — a suite
that never runs is F11's corpse.

---

## 3. Explicitly out of scope

- **Membership/subscription billing** (`applyStripeSubscriptionInTransaction`)
  — different lifecycle, different audit.
- **Pro payout correctness on Stripe's side** (destination charges,
  `reverse_transfer` clawbacks) — we verify our calls' arguments, not
  Stripe's ledger.
- **Enabling no-show protection** — M12 produces a readiness verdict only.
- **Group bookings / AI consult** — unbuilt specs; their money model should
  READ this doc when built, not the reverse.
- **Load/latency of the webhook path** — F15's cost work owns transaction
  budgets.

## 4. Status

| Card | Severity | State |
| --- | --- | --- |
| M1 pay→cancel→webhook black hole | 🔴 | ⬜ open |
| M2 expired deposit session poisons final bill | 🔴 | ⬜ open |
| M3 FAILED refund dead end | 🔴 | ⬜ open |
| M4 deposit-PI dispute unmatched | 🟠 | ⬜ open |
| M5 abandoned deposit squats the slot | 🟠 | ⬜ open |
| M6 cancel-time money honesty (web+iOS) | 🟠 | ⬜ open |
| M7 reconciler coverage matrix | 🟠 | ⬜ open |
| M8 lifecycle-contract bypass enumeration | 🟠 | ⬜ open |
| M9 manual closeout races | 🟡 | ⬜ open |
| M10 deposit-plan consistency across creation paths | 🟡 | ⬜ open |
| M11 display truth (web+iOS) | 🟡 | ⬜ open |
| M12 no-show fee readiness verdict | 🟡 | ⬜ open |
| M13 money-path test suite | 🟢 | ⬜ open |

**Queue protocol** (same as the F-series): one card per session, in order
unless a session's findings re-rank them; verify the premise before fixing;
drive the real interleaving, not just unit tests; update this table + append
a "what shipped" section per card; PR per card, merge on green; web+iOS land
together where a card spans both. When the queue closes, re-run §1's matrix
against the shipped code as the re-audit — and go looking in whatever the
fixes now exempt, because that's where the next three bugs live.

### Next-session prompt

> Work the payment↔booking integrity audit queue in
> `docs/design/payment-booking-integrity-audit-plan.md` — take **M1**
> (pay→cancel→webhook: money lands on a CANCELLED booking and nothing refunds
> it). Verify the premise first by driving the interleaving locally (deposit
> flavor first — hold the webhook, cancel, then deliver it), then fix per the
> card's direction, test both PIs × both sides of the 24h line, PR, merge on
> green, update the status table and append "M1 — what shipped".
