// lib/stripe/expandable.ts
//
// One reader for Stripe's EXPANDABLE fields.
//
// Any Stripe field that can be `expand`ed arrives either as a bare id string or,
// when expanded, as the full object — `session.payment_intent`,
// `paymentIntent.latest_charge`, `charge.balance_transaction`, and so on. Every
// caller that only wants the id has to handle both shapes, and the money path had
// grown SEVEN private copies of that unwrap under four different names and three
// signatures (three route-local `getSessionPaymentIntentId(value)`, two
// session-taking variants in the webhook handler and the orphan-recovery sweep,
// and two latest-charge variants in the webhook handler and the deposit-success
// recovery sweep).
//
// Empty-string normalization is the ONLY behavioural difference from the copies it
// replaces, and unifying them forces a choice: the three route-local copies mapped
// `''` to null (via a falsy guard) while the four field-specific ones returned `''`
// unchanged. Stripe never emits an empty id, so that divergence was unreachable
// rather than intentional. This takes null — every consumer either tests the result
// for falsiness (where '' and null behave alike) or writes it to a nullable id
// column, where null is the honest value for "no id".
//
// Nothing else is normalized. Notably it does NOT trim: no copy trimmed, and a
// quality refactor should not smuggle in a semantic tweak, however sensible, on an
// input none of the originals agreed to change.

/** The two shapes an unexpanded/expanded Stripe reference can arrive in. */
type StripeExpandable = string | { id?: unknown } | null | undefined

/**
 * The id of an expandable Stripe reference, whether Stripe sent the bare id or
 * the expanded object. Returns null for absent, blank, or unrecognizably-shaped
 * values — never throws, so a webhook payload that surprises us degrades to
 * "no id" instead of a 500.
 */
export function stripeExpandedId(value: StripeExpandable): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null

  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return value.id.length > 0 ? value.id : null
  }

  return null
}
