// lib/payments/resolveChargeCurrency.ts
//
// The currency the app charges, refunds and displays in — one home for what was
// eleven hand-written `?? 'usd'` / `?? 'USD'` expressions and bare literals
// scattered across the payment path.
//
// BEHAVIOUR TODAY IS EXACTLY WHAT IT WAS: the `Booking.stripeCurrency` column
// stays the source of truth wherever a booking is in hand, and 'USD' is the
// fallback when it is null. This module is centralisation, not a currency
// change — nothing about what reaches Stripe moves.
//
// ⚠️ WHY BOTH CASINGS EXIST. Stripe's API and its webhooks speak lowercase
// ('usd'); ISO 4217 and this repo's own `normalizeStripeCurrency` speak
// uppercase ('USD'). `Booking.stripeCurrency` therefore holds BOTH in
// production — `recordStripeCheckoutSessionAttached` upper-cases what it
// stores, while the `checkout.session.completed` webhook stores Stripe's raw
// lowercase. So `resolveChargeCurrency` preserves whatever case is stored and
// only supplies the default, and `resolveChargeCurrencyLower` is for the sites
// that must hand Stripe (or mirror into a column Stripe populates) its casing.
// Neither helper normalises a stored value into a case its call site did not
// already produce.
//
// 🔴 WHITE-LABEL SEAM — this is deliberately NOT `BrandConfig.currency`, and
// that field is a rejected proposal, not an unbuilt one. All THREE currencies
// that reach the Stripe API travel in a payload beside `connectedAccountId` —
// the two checkout/deposit line items built here in `writeBoundary`, and
// `noShowProtection/charge.ts`'s PaymentIntent with its `transfer_data`
// destination. Every one is a Connect destination charge on the
// PROFESSIONAL's own account, which has to support the currency. A brand-sheet
// field would be a control that looks authoritative, sits in a config file a
// tenant edits, and breaks payments the first time anyone sets it to something
// their pros' Stripe accounts cannot take.
//
// (The four in `refunds.ts` are NOT Stripe sends, whatever the cleanup register
// says: they are `bookingRefund.create({ currency })` rows. `refunds.create`
// takes no currency — a refund inherits its PaymentIntent's.)
//
// THE DEFERRED PLAN, stated so the next reader finds a plan and not a TODO:
// when international launch is scoped, the currency is resolved PER PRO from
// the pro's Stripe Connect account — `account.default_currency`, validated
// against the account's `capabilities`, cached on the pro's payment settings —
// and threaded into these call sites the way `connectedAccountId` already is.
// That is a payments programme with a Connect dependency, not a constant, and
// it lands here: every site above already calls this module, so the resolution
// changes in one file rather than eleven.

/**
 * The charge currency used when no stored value exists. ISO 4217 casing.
 */
export const DEFAULT_CHARGE_CURRENCY = 'USD'

/**
 * The charge currency for a booking, preserving the stored value's own casing.
 * Pass nothing where there is no stored column to read — the deposit and
 * no-show charges construct their own PaymentIntent rather than inheriting the
 * booking's, and the display formatters have no booking in hand at all.
 */
export function resolveChargeCurrency(stored?: string | null): string {
  return stored ?? DEFAULT_CHARGE_CURRENCY
}

/**
 * The same answer in Stripe's casing, for a Stripe API payload or a column that
 * mirrors one.
 */
export function resolveChargeCurrencyLower(stored?: string | null): string {
  return resolveChargeCurrency(stored).toLowerCase()
}
