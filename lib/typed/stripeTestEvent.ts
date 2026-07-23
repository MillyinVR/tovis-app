// lib/typed/stripeTestEvent.ts
//
// TEST-ONLY nominal-type boundary for wire-shaped Stripe event fakes.
//
// Dispatcher unit tests hand handleStripeEvent a small structural object
// ({ id, type, data: { object } }) where the signature demands the full
// Stripe.Event union. That narrowing mirrors what production legitimately does
// with a stored webhook payload (parseStoredStripeEvent narrows `unknown` after
// shape checks), and the fake only needs the fields the dispatcher reads — but
// it requires a type escape, and escapes are only allowed here in lib/typed
// with a justified boundary (tools/check-no-type-escape). Use this helper
// instead of scattering `as unknown as Stripe.Event` through test files.
//
// Never import from production code — production must verify a real signature
// (webhook route) or shape-check a stored payload (requeue) instead.
import type Stripe from 'stripe'

export function asTestStripeEvent(fake: object): Stripe.Event {
  return fake as unknown as Stripe.Event
}
