# Tovis Payments, Deposits, Discovery Fee & Membership — Build Spec

> Status: **DESIGN / not built**. Audit + implementation plan. No code changes made.
> Author session: 2026-06-17. This is a planning doc — sequencing and decisions
> may be split across multiple PRs.

## 0. Why this doc exists

Tovis currently runs payments on **Stripe Connect (Express) destination charges**.
Every booking charge lands on the platform account and is transferred to the pro's
connected account with **`application_fee_amount` never set** — so today **the
platform earns $0 on every transaction**. There is also **no deposit system**, **no
membership/subscription**, and **no financial/tax reporting** for pros.

This spec covers four net-new (or partially-built) areas:

- **A.** New-client discovery deposit + one-time platform fee
- **B.** Pro membership (free + paid tiers)
- **C.** Multi-payment-method acceptance + "mark payment complete" (mostly built — gap-fill)
- **D.** Pro dashboard transaction ledger + quarterly tax reporting

---

## 1. Current-state audit (what exists today)

### Payment processor
- Stripe only. `stripe@^22`, API `2026-04-22.dahlia`. Client in `lib/stripe/server.ts`.

### Money flow
- **Destination charges + Connect Express.** `app/api/client/bookings/[id]/checkout/stripe-session/route.ts`
  builds a Checkout Session (`mode: payment`, `card` only) with
  `payment_intent_data.transfer_data.destination = <pro connected account>`.
- Prep logic in `lib/booking/writeBoundary.ts` (`prepareClientStripeCheckoutSession`).
- **Platform take = 0.** `Booking.stripeApplicationFeeAmount` exists but is never populated.

### Connect onboarding (works)
- `app/api/pro/payments/stripe/connect-account/route.ts` — creates Express account
  (`card_payments` + `transfers` requested).
- `app/api/pro/payments/stripe/onboarding-link/route.ts` — AccountLink.
- `app/api/pro/payments/stripe/status/route.ts` — status.
- Status mirrored on `ProfessionalPaymentSettings` (`stripeAccountStatus`,
  `stripeChargesEnabled`, `stripePayoutsEnabled`, `stripeDetailsSubmitted`, …).
- Readiness gate `lib/pro/readiness/proReadiness.ts` → blocker `STRIPE_NOT_READY`
  until charges+payouts enabled.

### Refunds (works, high quality — PRs #166–#169)
- `lib/booking/refunds.ts` — per-booking advisory lock (ns 41022), reserves
  `BookingRefund` PENDING rows, idempotency key `tovis:refund:{refundId}`,
  `reverse_transfer: true`, `refund_application_fee` only when an app fee exists.
- Auto-refund on cancel: `lib/booking/cancelRefund.ts` (pro/admin always; client ≥24h full, <24h none).
- Discretionary: `app/api/bookings/[id]/refund/route.ts` (PRO/ADMIN, partial+full).
- Webhook reconcile: `charge.refunded` → `reconcileChargeRefundInTransaction`.

### Webhooks (works)
- `app/api/webhooks/stripe/route.ts`. Dedup via `StripeWebhookEvent` table.
- Handles: `checkout.session.completed|expired`, `payment_intent.succeeded|payment_failed`,
  `charge.refunded`, `account.updated`. Unknown events → 200 `handled:false`.

### Payment-method config (mostly built)
- `ProfessionalPaymentSettings` (schema ~1448): `acceptCash/CardOnFile/TapToPay/Venmo/Zelle/AppleCash/StripeCard`,
  `venmoHandle/zelleHandle/appleCashHandle`, `paymentNote`, `collectPaymentAt` (`AT_BOOKING|AFTER_SERVICE`),
  tips config.
- Editable UI: `app/pro/profile/public-profile/EditPaymentSettingsButton.tsx`.
- Off-platform "mark paid": `app/api/pro/bookings/[id]/checkout/mark-paid/route.ts`; `waive` route too.
- `PaymentMethod` enum: `CASH | CARD_ON_FILE | TAP_TO_PAY | VENMO | ZELLE | APPLE_CASH | STRIPE_CARD`.

### Discovery / relationship signals (all already present — key for Area A)
- `Booking.source: BookingSource` = `REQUESTED | DISCOVERY | AFTERCARE`.
- Looks feed: `app/api/looks/route.ts`; Discovery/search: `app/api/search/route.ts`.
- NFC: `lib/tapIntentConsume.ts` + `NfcCard` + `AttributionEvent`.
- Relationship history: prior `Booking`, `ProClientInvite` (claimStatus), `MessageThread`,
  `ProfessionalFavorite`, `ProFollow`, `Review`, `Referral`.

### Dashboard / reporting
- `app/pro/dashboard/ProOverviewDashboard.tsx` + `lib/analytics/proMonthlyAnalytics.ts`
  → monthly revenue, bookings, tips, top services. **Monthly only.**
- **Absent:** transaction ledger, per-booking list, quarterly/annual rollup, CSV/PDF export,
  tax-ID/W-9 capture, Stripe-fee tracking.

### Gaps summary
| Capability | State |
|---|---|
| Stripe Connect charges/payouts | ✅ works |
| Refund stack | ✅ works |
| Multi payment-method config | ✅ works |
| Off-platform "mark paid" | ✅ works |
| **Deposits** | ❌ column only, no behavior |
| **Platform fee** | ❌ field only, never set |
| **Saved cards / Stripe Customers (client)** | ❌ none |
| **Membership / subscription** | ❌ none (only `isPremium` bool for handles) |
| **Transaction ledger / tax export** | ❌ none |

---

## 2. DECISIONS LOCKED (this session)

- **Discovery fee:** **client pays a flat fee on top**, **one-time per new pro
  relationship**. Value: **default $5, configurable up to $10** via a single config
  constant (`TOVIS_DISCOVERY_FEE_CENTS`, default `500`). Rationale: protect the pro
  (don't tax their lead), client expects a matching/service fee, and a flat fee clears
  Stripe's ~2.9%+$0.30 per-transaction cost (a small % fee can net negative on a $20
  deposit). Launch at $5; raise toward $10 once conversion data exists.
- **Deposit amount:** **pro sets it** — flat $ *or* % of service price. Default off.
  Deposit is **refundable** under the pro's existing cancel policy (reuses the refund stack).
- **Refund RESETS the relationship (important):** the discovery fee marks a pair as
  "known" **only while a non-refunded fee exists**. If the client cancels and the fee is
  refunded, the (client, pro) pair reverts to "new" — so a later discovery booking
  **charges the fee again**. Detection therefore keys off *non-refunded, established*
  bookings, NOT merely "any prior booking ever existed." (See §3.1.)
- **Membership:** **permanent Free tier + paid "Pro" tier**, Studio/white-label later.
  - **Recommended pricing:** Pro **$29/mo (or $290/yr)**, **first month free** as a trial
    on top of the permanent Free tier. (User initially proposed $40/mo + a free month;
    recommendation is to keep a *permanent* free floor for acquisition and launch Pro
    lower at $29, raising later once tax-export/analytics value is proven. $40 is
    defensible but top-of-market with no track record yet.)

### Still open (need product calls before/while building)
1. Final Pro price ($29 recommended vs $40 proposed) and whether to add Studio at launch.
2. Paid-tier feature split — see §4.4 table (needs sign-off).
3. Whether membership reduces the discovery-fee share / unlocks priority Discovery
   (recommend: yes, as a Pro perk).
4. Discovery fee fate on cancel: keep on **client** cancel, refund on **pro** cancel
   (recommended — mirror the deposit's fate to whoever caused the cancel).

---

## 3. AREA A — Discovery deposit + one-time platform fee

### A.1 Trigger rule (evaluated at booking finalize)

Charge **deposit + flat platform fee** when ALL are true:

```
booking.source == DISCOVERY
AND pro.depositEnabled == true
AND the pro is Stripe-ready (charges + payouts enabled)
AND NO "established relationship" exists for (clientId, professionalId)
```

Where **"established relationship"** = ANY of:
- a prior **non-cancelled** Booking (PENDING/ACCEPTED/IN_PROGRESS/COMPLETED) for the pair, OR
- an **ACCEPTED** `ProClientInvite` (on the pro's roster), OR
- a prior `MessageThread` for the pair, OR
- the client arrived via THIS pro's NFC card (`AttributionEvent` / `NfcCard`).

**Refund-reset nuance (locked decision):** a booking whose discovery fee was **refunded**
does NOT establish the relationship. So when evaluating "prior non-cancelled booking",
exclude bookings that were cancelled/refunded such that the discovery fee was returned.
Concretely: the pair counts as "known" only if there exists a prior booking that is
**active or completed AND whose discovery fee (if any) was not refunded**. If the only
prior contact was a cancelled+refunded discovery booking, the pair is "new" again and
the fee is charged on the next discovery booking.

Otherwise: existing flow, **no platform fee**. (Deposit may still apply if the pro set
`depositAppliesTo` broader than discovery — see §A.3 — but the **platform fee is
strictly new-via-discovery only**.)

New helper: `lib/booking/discoveryFee.ts`
```ts
import { BookingSource } from '@prisma/client'

// Pure, unit-testable. Takes pre-loaded signals (no I/O) and returns a verdict.
// "established" counts exclude cancelled+fee-refunded bookings (refund-reset rule).
export function isNewDiscoveryClient(input: {
  source: BookingSource
  proDepositEnabled: boolean
  proStripeReady: boolean
  establishedBookingCount: number   // active/completed, non-fee-refunded, for this pair
  acceptedInviteCount: number
  threadCount: number
  arrivedViaProNfc: boolean
}): boolean
```
Called from `app/api/bookings/finalize/route.ts` with counts loaded in the same
transaction that finalizes the hold. Keep the queries cheap (COUNT with limit 1 each,
or one combined query). The "establishedBookingCount" query must filter OUT cancelled
bookings whose discovery fee was refunded.

### A.1.1 Provenance trust model + build status

**Critical finding (resolved):** `Booking.source` and the booking-entry-point are
**client-supplied and not server-validated** for money decisions today — a client
could send `source: REQUESTED` to dodge the fee. So the fee must NOT key off `source`.
Instead we introduce **`BookingDiscoveryProvenance`** (new enum) — a server-validated
signal stamped on the booking, resolved from DB facts only.

Provenance resolution (`lib/booking/discoveryProvenance.ts`, pure + tested):
precedence `PRO_CREATED > AFTERCARE > NFC > LOOKS_FEED (validated lookPost) >
discovery-view attribution > DIRECT_PROFILE`. We only ever resolve to a discovery
value on **positive server proof**, so we never over-charge.

- **LOOKS_FEED** — fully server-validatable now: at finalize, resolve `lookPostId`/
  `mediaId` and confirm the LookPost belongs to this pro. ✅ buildable end-to-end.
- **DISCOVERY_SEARCH** — needs a server-recorded **discovery-view attribution**
  (`AttributionEvent`, e.g. `eventType: 'DISCOVERY_VIEW'`, `actorUserId=client`,
  `metaJson.professionalId`) written when the client opens the pro from the Discovery
  tab — so it can't be forged by the booking request. Finalize reads the most-recent
  such event for (client, pro). ⏳ requires the view-recording step (per the chosen
  "build search attribution" scope).

**Built so far (branch `feature/payments-membership`):**
- Schema + migration `20260617190000_add_deposits_discovery_fee` (deposit settings,
  deposit-as-its-own-charge fields, `discoveryProvenance` on Booking + BookingHold).
- `lib/booking/discoveryProvenance.ts` (resolver) + `lib/booking/discoveryFee.ts`
  (`isNewDiscoveryClient` keyed off provenance, fee config). 20 unit tests, typecheck clean.

**Still to wire:** finalize loads provenance + relationship signals → resolver →
`isNewDiscoveryClient` → Stripe deposit charge w/ `application_fee`; discovery-view
attribution recording; refund-reset; pro settings + client checkout UI; live test.

### A.1.2 Collection layer is net-new (finding)

The existing client Stripe checkout
(`app/api/client/bookings/[id]/checkout/stripe-session/route.ts` +
`prepareClientStripeCheckoutSession`) is **post-service**: it hard-requires finalized
aftercare (`aftercareSummary.sentToClientAt`) and charges the final bill with
`transfer_data` but **no `application_fee_amount`**. So deposit-at-booking collection
is genuinely new and must NOT reuse that path (and the fee must ride the deposit
charge, not the final bill — which may be paid off-platform).

**Built (decision/record layer, branch `feature/payments-membership`):**
- `lib/booking/discoveryDepositPlan.ts` — deposit/fee math (FLAT/PERCENT, Stripe-min clamp).
- `lib/booking/resolveDiscoveryFinalize.ts` — server-side provenance + relationship
  resolution (validates lookPost ownership, NFC, discovery-view; counts exclude
  fee-refunded bookings). Wired into `finalize/route.ts`.
- `writeBoundary.finalizeBookingFromHold` now stamps `discoveryProvenance` and, when
  fee-eligible, records `depositStatus=PENDING`, `depositAmount`, `discoveryFeeAmount`.
- 28 unit tests + typecheck green.

**Collection layer — BUILT + LIVE-PROVEN:**
- `prepareClientDepositCheckout` / `recordDepositCheckoutAttached` /
  `applyStripeDepositSucceededInTransaction` in `writeBoundary.ts`.
- Endpoint `POST /api/client/bookings/[id]/deposit/stripe-session` — Checkout Session
  for `deposit + fee`, `application_fee_amount = fee`, `transfer_data.destination = pro`,
  `metadata.kind = DISCOVERY_DEPOSIT`.
- Webhook routes `DISCOVERY_DEPOSIT`-tagged `checkout.session.completed` /
  `payment_intent.succeeded` to mark `depositStatus=PAID`, `depositPaidAt`, deposit
  PI/charge — without touching the final-bill fields. 572 booking/webhook tests green.
- **Live Stripe test-mode run PASSED (2026-06-17):** $20 deposit + $5 fee destination
  charge split correctly ($20→pro, $5→platform via application fee); full refund with
  `reverse_transfer` + `refund_application_fee` reversed cleanly. The previously-never-run
  charge path now works.

**Refund-reset — BUILT (task #5):**
- Detection: `resolveDiscoveryFinalize`'s established-pair query now distinguishes a
  *forfeited/kept* fee (cancelled booking with a captured, non-refunded fee → still
  establishes, no re-charge) from a *refunded* fee (`discoveryFeeRefundedAt` set →
  pair reverts to "new" → re-charge). Refund-reset works as the user specified.
- Execution: `applyDiscoveryDepositCancelRefund` (in `cancelRefund.ts`) refunds the
  deposit PI directly (separate from the final-bill refund stack) with
  `reverse_transfer`, and `refund_application_fee` only when the fee is returned.
  Policy via pure `resolveDepositRefundPlan`: pro/admin → deposit + fee; client ≥24h →
  deposit, keep fee; client <24h → forfeit. Stamps `discoveryFeeRefundedAt` only when
  the fee is actually refunded. Idempotent (per-booking claim + Stripe idempotency key);
  best-effort (never fails the committed cancel). Wired into BOTH cancel routes.
- Webhook: `reconcileDepositChargeRefundInTransaction` handles out-of-band (dashboard)
  deposit refunds — marks `depositStatus=REFUNDED`, stamps fee-refund on a full refund.
- 873 booking/webhook/cancel tests + typecheck green.

**UI — BUILT (task #6):**
- Pro: a "Deposits" section in `EditPaymentSettingsButton` (enable, FLAT/PERCENT amount,
  scope: new-discovery-only / all-new / all). Persisted via `/api/pro/payment-settings`
  (new fields + validation); threaded through the profile loader + DTO + page test.
- Client: `ClientDepositCard` on the booking detail page — shows the deposit + one-time
  fee as line items and a "Pay deposit & booking fee" button that creates the deposit
  Checkout Session and redirects to Stripe; shows "Deposit paid ✓" once captured.
- Verified: full typecheck + 880+ tests green; dev server compiles both routes (client
  page 200, deposit API 403 unauth), no console errors.

**Phase 1 remaining (smaller follow-ups):** booking-lifecycle enforcement (auto-expire/
hold a booking whose deposit goes unpaid); pre-booking fee disclosure on the discovery
booking screen; full in-app e2e with a seeded authed client + pending deposit.

### A.2 Stripe mechanics

Reuse destination-charge model. On the deposit checkout:

```
amount        = depositAmount + platformFee   (client pays both)
application_fee_amount = platformFee           // Tovis keeps this
transfer_data.destination = pro connected acct // deposit settles to pro
metadata = { bookingId, kind: "DISCOVERY_DEPOSIT", platformFeeCents }
```

- Populate `Booking.stripeApplicationFeeAmount = platformFee` (the field that exists
  but is currently always null). The refund stack already honors
  `refund_application_fee` when an app fee is present — so refund behavior comes
  "for free", but **verify in test mode** since this path has never run in prod.
- The deposit **credits toward the final bill**: at final checkout, charge
  `total - depositAlreadyPaid`. The platform fee is **not** credited (it's Tovis's).

> **Saved-card consideration:** "deposit now, remainder later" ideally reuses the
> card. Today there are no Stripe Customers / saved PMs. Two options:
> - **(Simpler, phase 1)** Deposit is its own one-time charge; final remainder is a
>   separate checkout (client re-enters card or pays off-platform). Works with zero
>   new infra.
> - **(Better UX, phase 2)** Create a Stripe Customer + SetupIntent at deposit time,
>   save the PM, charge remainder off-session. New infra; do later.
> Recommend phase-1 simple first.

### A.3 Pro deposit settings (new fields)

Add to `ProfessionalPaymentSettings`:
```prisma
depositEnabled     Boolean   @default(false)
depositType        DepositType @default(FLAT)   // new enum: FLAT | PERCENT
depositFlatAmount  Decimal?  @db.Decimal(10, 2) // when FLAT
depositPercent     Int?                          // when PERCENT (1–100)
depositAppliesTo   DepositScope @default(NEW_DISCOVERY_ONLY)
// new enum DepositScope: NEW_DISCOVERY_ONLY | ALL_NEW_CLIENTS | ALL_CLIENTS
```
- `depositAppliesTo` lets the pro choose breadth. **Platform fee still only applies to
  the new-via-discovery subset** regardless of this setting.
- Compute deposit at finalize: `FLAT → depositFlatAmount`; `PERCENT → round(service * pct)`.
  Consider a platform min ($) so deposits aren't sub-$1 (Stripe minimum charge is $0.50).
- Surface in `EditPaymentSettingsButton.tsx`.

### A.4 Platform fee config (platform-level, not per-pro)
- Store as env/config constant first (`TOVIS_DISCOVERY_FEE_CENTS`, e.g. `200`–`300`).
  Promote to a DB-backed `PlatformConfig` row later if it needs runtime tuning.

### A.5 Schema additions for the booking
`Booking` already has `depositAmount` and `stripeApplicationFeeAmount`. Add:
```prisma
platformFeeKind   String?   // e.g. "DISCOVERY_DEPOSIT" — disambiguates app-fee origin
depositCreditedAt DateTime? // when the deposit was applied against the final total
```

### A.6 Client UX
- On the discovery booking screen, when the rule fires, show:
  "This pro requires a $X deposit to hold your appointment, plus a one-time $Y
  Tovis booking fee. The deposit goes toward your service total."
- Reuse existing checkout UI; deposit + fee are line items.
- Returning/known clients never see this.

### A.7 Edge cases
- **Deposit < Stripe minimum ($0.50):** clamp/skip; never create a sub-minimum charge.
- **No-show / cancel:** deposit refundability follows the pro's existing cancel policy
  via the existing refund stack. The **platform fee** — decide: keep (it's a matching
  fee already earned) vs refund on pro-initiated cancel. Recommend **keep on client
  cancel, refund on pro cancel** (mirror the deposit's fate to the pro's fault).
- **Pro not Stripe-ready:** can't take a platform-processed deposit → either block the
  discovery deposit path or fall back to "no deposit" (recommend: no deposit, since
  the fee requires Connect). Surface as a pro readiness nudge.
- **Race / double-charge:** rely on existing booking idempotency keys.

---

## 4. AREA B — Pro membership (free + paid tiers)

This is **Stripe Billing** (subscriptions), distinct from Connect. Here **the pro is
the customer paying Tovis** (charges on the platform account, no transfer).

### B.0 BUILD STATUS — Phase 2 BUILT (branch `feature/payments-membership`)

- **Schema + migration** `20260617200000_add_membership_subscriptions`: `SubscriptionPlan`
  + `ProfessionalSubscription` + `SubscriptionStatus` enum. Applied to local dev DB.
- **Entitlements** `lib/pro/entitlements.ts` — code-defined matrix (Free/Pro/Studio),
  lapsed→free, core paths never gated. 8 unit tests.
- **Billing routes** `app/api/pro/membership/{checkout,portal,status}` + `lib/membership/`
  (plans config, get-or-create customer/subscription). Connect acct id kept distinct
  from Billing customer id.
- **Webhooks** `customer.subscription.created|updated|deleted` → `ProfessionalSubscription`
  sync (`lib/membership/syncSubscription.ts`), which also **backfills the legacy
  `isPremium` column** from the `custom_handle` entitlement (the isPremium→entitlement
  migration, done as an automatic backfill so existing readers reflect membership).
- **UI** `app/pro/membership` (tier cards, upgrade→checkout, manage→portal).
- **Live test-mode PASSED:** real Pro subscription created with the 30-day trial,
  status `trialing` → maps to `TRIALING`, plan `pro`. Stripe Product `prod_Uiy89icQscEWvJ`
  + Price `price_1TjWC2L1j5wI4AXlGPdVOaw5` ($29/mo) created in sandbox.
- **Verified:** 1409 tests green across touched areas + typecheck; dev server renders
  `/pro/membership` (200) and all 3 APIs auth-gate (401).
- **Config needed to go live:** set `STRIPE_PRO_MONTHLY_PRICE_ID` (test price above for
  dev; a live recurring price for prod). `SubscriptionPlan` table is reserved for future
  admin pricing — runtime reads the code config, so no seed required.

### B.1 New models
```prisma
model SubscriptionPlan {
  id              String  @id @default(cuid())
  key             String  @unique   // "free" | "pro" | "studio"
  name            String
  stripeProductId String?
  stripePriceId   String?            // null for free
  priceCents      Int     @default(0)
  interval        String?            // "month" | "year"
  features        Json               // entitlement map
  isActive        Boolean @default(true)
  sortOrder       Int     @default(0)
}

model ProfessionalSubscription {
  id                   String   @id @default(cuid())
  professionalId       String   @unique
  planKey              String   @default("free")
  status               SubscriptionStatus @default(ACTIVE) // ACTIVE|PAST_DUE|CANCELED|TRIALING|INCOMPLETE
  stripeCustomerId     String?  @unique
  stripeSubscriptionId String?  @unique
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  professional         ProfessionalProfile @relation(fields: [professionalId], references: [id], onDelete: Cascade)
}
```
- Every pro implicitly has the **free** plan (lazily create a `ProfessionalSubscription`
  row, or treat missing row as free).

### B.2 Stripe Billing wiring
- Create Stripe **Products + Prices** for paid tiers (seed script or Stripe dashboard).
- New routes under `app/api/pro/membership/`:
  - `POST /checkout` → Stripe Checkout `mode: subscription` (creates/reuses Customer).
  - `POST /portal` → Stripe Billing Portal session (manage/cancel/update card).
  - `GET /status` → current plan + entitlements.
- Webhooks: extend `app/api/webhooks/stripe/route.ts` to handle
  `customer.subscription.created|updated|deleted` and `invoice.paid|payment_failed`
  → sync `ProfessionalSubscription.status/planKey/currentPeriodEnd`. The dedup
  infra (`StripeWebhookEvent`) already handles idempotency.

> **Connect vs Billing separation:** a pro is simultaneously a **connected account**
> (receives client money) and a **customer** (pays Tovis for membership). These are
> two different Stripe objects on the same pro — keep IDs distinct
> (`paymentSettings.stripeAccountId` = Connect; `subscription.stripeCustomerId` = Billing).

### B.3 Entitlement gating (new)
No gating exists today. Add:
```ts
// lib/pro/entitlements.ts
export type Entitlement = 'analytics_advanced' | 'tax_export' | 'lower_discovery_fee'
  | 'white_label' | 'custom_handle' | 'priority_discovery' | ...
export async function hasEntitlement(professionalId: string, ent: Entitlement): Promise<boolean>
export function requireEntitlement(ent: Entitlement): /* route guard */
```
- Resolve from `SubscriptionPlan.features` for the pro's current plan.
- Fail open vs closed: gate **only premium add-ons**, never core booking/payment paths
  (a lapsed sub must still be able to take existing bookings & get paid).

### B.4 Proposed tier split (DRAFT — needs your sign-off)
| Capability | Free | Paid ("Pro") | Higher ("Studio")? |
|---|---|---|---|
| Take bookings, get paid (Connect) | ✅ | ✅ | ✅ |
| Accept off-platform methods + mark-paid | ✅ | ✅ | ✅ |
| Monthly dashboard | ✅ | ✅ | ✅ |
| Custom `.tovis.me` handle (today's `isPremium`) | ❌ | ✅ | ✅ |
| Transaction ledger + CSV/quarterly tax export (Area D) | ❌ | ✅ | ✅ |
| Advanced analytics / retention insights | ❌ | ✅ | ✅ |
| Reduced/zero discovery-fee share, or priority in Discovery | ❌ | ✅/partial | ✅ |
| White-label / salon multi-pro | ❌ | ❌ | ✅ |

- **Migrate `isPremium`:** the existing `ProfessionalProfile.isPremium` boolean (controls
  custom handle) should be **derived from plan entitlement** going forward; keep the
  column during transition, backfill from subscription, then deprecate.

---

## 5. AREA C — Multi-payment methods + "mark complete" (gap-fill)

### C.0 BUILD STATUS — Area C BUILT (branch `feature/payments-membership`)

- **Schema + migration** `20260617210000_add_paypal_applepay_methods`: `PAYPAL` +
  `APPLE_PAY` added to `PaymentMethod`; `acceptPaypal` / `acceptApplePay` + `paypalHandle`
  on `ProfessionalPaymentSettings`. Applied to local dev DB.
- **Save route** `/api/pro/payment-settings`: parses/validates/persists the new fields
  (PayPal requires a handle/link; Apple Pay is a handle-less toggle like Cash).
- **Pro UI**: PayPal (+ handle) and Apple Pay toggles in `EditPaymentSettingsButton`,
  threaded through the profile loader/DTO/type + page-test fixture.
- **Client surface**: PayPal + Apple Pay added to `buildAcceptedMethods`, so clients
  see the pro's accepted off-platform methods + handles + `paymentNote` at checkout.
  The client payment-settings loader selects + normalizes the new fields.
- **Constraint preserved**: the discovery deposit + platform fee remain a separate
  Stripe-card-only charge; off-platform methods (incl. PayPal/Apple Pay) only apply to
  the final bill. The pro's existing "mark paid" loop flips the client's checkout state
  to PAID for any off-platform method — unchanged, now covers the new methods too.
- **Verified**: 633 profile/booking/pro-api tests + full typecheck green; dev server
  renders pro profile, client booking, and membership pages (200), no errors.

> Original remaining work (now done):

- **Enum gaps:** add `PAYPAL` and `APPLE_PAY` to `PaymentMethod` + corresponding
  `acceptPaypal`/`acceptApplePay` + `paypalHandle` on `ProfessionalPaymentSettings`,
  and to `EditPaymentSettingsButton.tsx`. (Note: "Apple Pay" via Stripe is just a card
  method; the off-platform one clients mean is usually Apple Cash, which already exists.
  Confirm whether PayPal is wanted.)
- **Client-facing surface:** on the booking/checkout screen, render the pro's accepted
  **off-platform** methods + handles + `paymentNote`, so the client knows how to pay
  the pro directly. Today the data exists but isn't shown to clients at the decision point.
- **"Payment complete" loop:** the pro confirms an off-platform payment via the existing
  `mark-paid` route; ensure the client sees a "paid" state. This closes the loop for any
  Venmo/Zelle/Cash/PayPal payment.
- **Important constraint:** the **discovery deposit + platform fee must go through Stripe**
  (that's the only way Tovis captures the fee). Off-platform methods are for the rest of
  the bill / known clients. Make the UI enforce: new-discovery deposit = card only.

---

## 6. AREA D — Dashboard ledger + quarterly tax reporting

Goal: "take tax stress off pros." All needed per-booking fields already exist on
`Booking` (`subtotalSnapshot`, `serviceSubtotalSnapshot`, `productSubtotalSnapshot`,
`tipAmount`, `taxAmount`, `discountAmount`, `depositAmount`, `stripeApplicationFeeAmount`,
`selectedPaymentMethod`, `paymentProvider`, `stripePaidAt`, `clientId`) plus
`BookingRefund` and `ProductSale`. They're just not surfaced as a list/export.

### D.1 Transaction ledger view (new)
- New page `app/pro/dashboard/transactions/` (gated by `tax_export`/paid tier).
- Per-row: date, client (or "—"), service/products, gross, tip, **platform fee**,
  **Stripe processing fee** (see note), refund, payment method, **net to pro**.
- Backed by a query over `Booking` (+ `BookingRefund`, `ProductSale`) for a date range.

> **Stripe processing fee is not stored today.** Two options: (a) compute estimate
> (2.9% + $0.30) for display only, clearly labeled "estimated"; (b) read the Balance
> Transaction from Stripe to get the exact fee and persist it on the booking. Recommend
> (a) for v1, (b) later for accurate 1099-style numbers.

### D.2 Quarterly / annual rollup + export
- Date-range + quarter presets (Q1–Q4, full year).
- Totals: gross service income, product income, tips, refunds, platform fees,
  estimated processing fees, **net**.
- **Export CSV** (accountant-friendly) and optional **PDF statement**. CSV first.

### D.3 Tax-info capture (new, optional but enables 1099-style summaries)
- Add to pro profile: legal name, business type, tax ID / W-9 status (encrypt per the
  app's existing PII keyring pattern — see `lib/` PII helpers). Absent today.
- Not required for the basic ledger/export; required if Tovis ever issues tax forms.

### D.4 Reuse existing analytics
- Lean on `lib/analytics/proMonthlyAnalytics.ts` patterns for aggregation; extend to
  arbitrary date ranges rather than month-only.

---

## 7. Suggested build sequencing

1. **Phase 1 — Deposits + discovery fee (Area A, phase-1 simple).**
   Highest product value, touches the live booking flow, and finally turns on platform
   revenue. Schema fields + `isNewDiscoveryClient` helper + Stripe app-fee on deposit +
   pro deposit settings UI + client UX. **Verify in Stripe test mode** (app-fee path
   has never run).
2. **Phase 2 — Membership (Area B).** Models + Stripe Billing + webhooks + entitlement
   guard + tier UI. Migrate `isPremium` to entitlement.
3. **Phase 3 — Dashboard ledger + tax export (Area D).** Gated behind paid tier from
   Phase 2.
4. **Phase 4 — Gap-fill payment methods + saved-card deposit UX (Area C + A phase-2).**

Each phase is independently shippable.

---

## 8. Risks & things to verify with a live test
- **App-fee path is unexercised in prod.** First discovery deposit must be validated in
  Stripe test mode: confirm fee split, payout to pro, and `refund_application_fee` on refund.
- **Deposit fields are currently dead code** — don't assume they work.
- **No saved cards** — "deposit then remainder" needs SetupIntent/Customer (phase 2) or
  two separate checkouts (phase 1).
- **Connect vs Billing object hygiene** — never conflate the pro's connected-account ID
  with their billing-customer ID.
- **Don't gate core earning paths** behind membership — a lapsed sub must still take
  bookings and get paid.
- **Stripe minimum charge** ($0.50) — clamp tiny deposits.

---

## 9. Key file references
- Checkout: `app/api/client/bookings/[id]/checkout/stripe-session/route.ts`,
  `lib/booking/writeBoundary.ts`
- Finalize (where the discovery rule fires): `app/api/bookings/finalize/route.ts`
- Refunds: `lib/booking/refunds.ts`, `lib/booking/cancelRefund.ts`,
  `app/api/bookings/[id]/refund/route.ts`
- Webhooks: `app/api/webhooks/stripe/route.ts`
- Connect: `app/api/pro/payments/stripe/*`
- Pro payment settings: `ProfessionalPaymentSettings` (schema ~1448),
  `app/pro/profile/public-profile/EditPaymentSettingsButton.tsx`
- Mark-paid: `app/api/pro/bookings/[id]/checkout/mark-paid/route.ts`
- Dashboard/analytics: `app/pro/dashboard/ProOverviewDashboard.tsx`,
  `lib/analytics/proMonthlyAnalytics.ts`
- Schema: `prisma/schema.prisma` (`Booking`, `BookingRefund`, `ProfessionalPaymentSettings`,
  `BookingSource`, `PaymentMethod`, `ProfessionalMonthlyAnalytics`)
