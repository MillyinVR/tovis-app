// lib/stripe/keyMode.ts
//
// Which Stripe MODE a key belongs to — `test` or `live` — derived from the key's
// own prefix, never from an env var that says so separately.
//
// 🔴 Why this exists (2026-08-20). The membership audit stalled for a week on
// "what mode is production's Stripe in?", and the answer was recorded as
// unknowable from the repo. It was not: it was simply never surfaced anywhere a
// deployed app could be asked. The mode was eventually established by fetching
// production's own JS bundle and grepping the inlined publishable key — which
// works, but is not a check anyone will run twice, only reveals the PUBLISHABLE
// key, and says nothing about whether the SECRET key agrees with it.
//
// So the mode is reported on the readiness probe instead (lib/health/stripe.ts),
// for both keys, with an explicit agreement flag. A test-mode secret key paired
// with a live-mode publishable key (or vice versa) is a configuration that looks
// healthy in every other check and cannot take a payment.
//
// ⚠️ This module returns a MODE and never the key. Nothing here may widen to
// echo, log, or partially render key material: the readiness probe is public.

/** The mode a Stripe key belongs to, or why it could not be determined. */
export type StripeKeyMode = 'test' | 'live' | 'missing' | 'unrecognized'

// Stripe prefixes its keys `<kind>_<mode>_<random>`: `pk_` publishable, `sk_`
// secret, `rk_` restricted. The mode is the SECOND segment, which is why this
// matches on `_test_` / `_live_` rather than on any single key kind — a
// restricted key is still a real key and still has a mode.
const TEST_MARKER = '_test_'
const LIVE_MARKER = '_live_'

/**
 * The mode of a Stripe key, from its prefix.
 *
 * `missing` = unset/blank (an unconfigured environment); `unrecognized` = set to
 * something that is not a Stripe key shape. The two are kept apart on purpose:
 * "nobody configured Stripe here" and "somebody configured it wrong" want very
 * different responses, and collapsing them hides the second behind the first.
 */
export function stripeKeyMode(raw: string | null | undefined): StripeKeyMode {
  const value = raw?.trim() ?? ''
  if (value === '') return 'missing'
  if (value.includes(TEST_MARKER)) return 'test'
  if (value.includes(LIVE_MARKER)) return 'live'
  return 'unrecognized'
}

/**
 * Whether two keys are usable together. Stripe rejects a publishable key from a
 * different mode than the secret key, so disagreement is a hard payment failure
 * rather than a warning — but only when BOTH modes actually resolved. When
 * either side is missing or unrecognized there is no disagreement to report,
 * just an absent fact, so this returns null rather than a misleading `false`.
 */
export function stripeKeyModesAgree(
  a: StripeKeyMode,
  b: StripeKeyMode,
): boolean | null {
  const resolved = (mode: StripeKeyMode) => mode === 'test' || mode === 'live'
  if (!resolved(a) || !resolved(b)) return null
  return a === b
}
