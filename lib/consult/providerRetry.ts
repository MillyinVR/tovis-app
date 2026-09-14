// lib/consult/providerRetry.ts
//
// One extra attempt for a paid consult call whose first answer was unusable.
//
// ## Why this exists
//
// The analysis RUN has a retry budget (`ConsultAnalysisRun.attemptCount`, three
// attempts). The two calls that hang off the end of it have none: the
// suitability translation and the follow-up round are each single-shot, and a
// single bad answer is the end of them. On 2026-09-13 both failed on the same
// consult, both with BAD_OUTPUT, and between them they are 0-for-1 in
// production — neither has ever succeeded there. A client lost her suitability
// translation and every follow-up question to two calls that were never asked
// twice.
//
// ## Why only `bad_output`
//
// 🔴 A retry is offered for BAD_OUTPUT and nothing else, and the exclusions are
// the point:
//
//   * `bad_output` — the provider answered quickly and this repo rejected the
//     answer. Retrying costs one more call and almost no wall-clock, because
//     the failure arrived at provider speed rather than at timeout speed. This
//     is the case actually observed in production.
//
//   * `unavailable` — a timeout or a transport failure. Retrying DOUBLES the
//     worst case, and for the follow-up call that directly contradicts the
//     design its own file states: a 20s timeout, chosen because "a round that
//     takes longer than that has already failed her, and the fallback ... is a
//     better answer than a spinner". A second 20s wait is the spinner.
//
//   * `refused` — the model declined. Asking the same question again is not
//     error handling, and a retry loop around a refusal is the shape of
//     working around a safety decision rather than respecting it.
//
//   * `no_vocabulary` — not a failure at all. It means there is nothing left to
//     ask, which a second call cannot change.
//
// ## What a retry costs
//
// A second paid call, metered separately — by design. `meterConsultProviderCall`
// wraps the inner call, so both attempts appear in `ConsultProviderCall` with
// their own cost and their own `failureCheck`. The meter must show what was
// actually spent, and a retry that hid its first attempt would under-report
// exactly the failure mode this file exists to survive.

/**
 * Is this the one error kind a second attempt can plausibly fix?
 *
 * Duck-typed on `kind` rather than on a class, for the same reason
 * `consultProviderOutcomeForErrorKind` is: the consult engines each throw their
 * own error class and all of them share this one vocabulary.
 */
export function isRetryableConsultProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('kind' in error)) return false
  return (error as { kind: unknown }).kind === 'bad_output'
}

/**
 * Run `attempt`, and if it fails in a way a second try can fix, run it once
 * more. At most two attempts, ever — this is not a retry loop.
 *
 * `canStartRetry` is the caller's latency gate: it is consulted BEFORE the
 * second attempt starts, so a call that is already close to its deadline
 * surfaces the first failure instead of blowing the budget. A caller with no
 * deadline omits it.
 *
 * The error thrown on failure is always the LAST one, so the caller's fallback
 * and its logging see the attempt that actually ended the call.
 */
export async function withOneConsultRetry<T>(args: {
  attempt: (attemptNumber: 1 | 2) => Promise<T>
  canStartRetry?: () => boolean
  onRetry?: (error: unknown) => void
  retryable?: (error: unknown) => boolean
}): Promise<T> {
  const retryable = args.retryable ?? isRetryableConsultProviderError
  try {
    return await args.attempt(1)
  } catch (error: unknown) {
    if (!retryable(error)) throw error
    if (args.canStartRetry && !args.canStartRetry()) throw error
    args.onRetry?.(error)
    return args.attempt(2)
  }
}
