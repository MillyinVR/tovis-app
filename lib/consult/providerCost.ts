// lib/consult/providerCost.ts
//
// What a consult's paid provider calls cost, in money.
//
// The prices are committed here rather than read from an env var or the
// provider at runtime for the same reason the model allowlist is committed
// (lib/consult/providerModel.ts): a consult's cost is a number this business
// reports on, and a silently-changed rate would rewrite history rather than
// record it. A model with no entry here is priced NULL — the meter still
// records every token it spent. That is deliberate: "we do not have a
// committed price for this model" and "this call was free" are different
// facts, and only one of them is ever true.
//
// Rates are per-token in NANO-dollars so every current rate is an exact
// integer (2 USD / 1M tokens = 2000 nUSD/token; a 0.1x cache read = 200
// nUSD/token). Rounding happens exactly once, at the end, into the µUSD the
// column stores.

/** Rates for one model, in nano-USD per token. */
export type ConsultProviderRates = {
  input: number
  output: number
  /** Writing the cache costs ~1.25x the input rate. */
  cacheWrite: number
  /** Reading it back costs ~0.1x. */
  cacheRead: number
}

/**
 * Anthropic first-party list prices, checked 2026-09-04.
 *
 * `claude-sonnet-5` is $2.00 / MTok input and $10.00 / MTok output — the only
 * model this repo is allowed to send consult photos to
 * (CONSULT_PROVIDER_MODEL_ALLOWLIST). Adding a model to that allowlist without
 * adding it here is legal and safe: the calls are metered, just unpriced.
 */
export const CONSULT_PROVIDER_RATES: Readonly<
  Record<string, ConsultProviderRates>
> = {
  'claude-sonnet-5': {
    input: 2_000,
    output: 10_000,
    cacheWrite: 2_500,
    cacheRead: 200,
  },
}

export type ConsultProviderUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
}

/** A token count that is safe to persist to an `Int` column. */
function tokenCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.min(Math.trunc(value), 2_000_000_000)
}

/**
 * The provider's `usage` block, narrowed to the four counts this repo stores.
 *
 * Deliberately structural rather than typed against the SDK's `Usage`: the
 * cache fields are nullable there and new fields arrive over time, and a meter
 * that throws on an unfamiliar usage shape would fail a call that already
 * succeeded and was already billed.
 */
export function readConsultProviderUsage(usage: unknown): ConsultProviderUsage {
  const source =
    usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : {}
  const read = (key: string): number => {
    const value = source[key]
    return tokenCount(typeof value === 'number' ? value : 0)
  }
  return {
    inputTokens: read('input_tokens'),
    outputTokens: read('output_tokens'),
    cacheCreationInputTokens: read('cache_creation_input_tokens'),
    cacheReadInputTokens: read('cache_read_input_tokens'),
  }
}

/**
 * Cost in millionths of a US dollar, or null when the model has no committed
 * price. Never throws and never guesses a rate from a similar model name.
 */
export function consultProviderCostMicroUsd(
  model: string,
  usage: ConsultProviderUsage,
): number | null {
  const rates = CONSULT_PROVIDER_RATES[model]
  if (!rates) return null

  const nanoUsd =
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    usage.cacheCreationInputTokens * rates.cacheWrite +
    usage.cacheReadInputTokens * rates.cacheRead

  // One rounding, at the end. `Int` tops out around $2,147 for a single call —
  // four orders of magnitude above the most expensive call this pipeline can
  // make — but clamp rather than overflow the column if that ever stops being
  // true.
  return Math.min(Math.round(nanoUsd / 1_000), 2_000_000_000)
}

/** `$0.0412` — for operator-facing logs and the live test's report, not the client. */
export function formatConsultProviderCost(costMicroUsd: number | null): string {
  if (costMicroUsd === null) return 'unpriced'
  return `$${(costMicroUsd / 1_000_000).toFixed(4)}`
}
