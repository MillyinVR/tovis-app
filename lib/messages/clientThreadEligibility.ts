// lib/messages/clientThreadEligibility.ts
//
// Single source of truth for "can a message thread be opened with this client?"
//
// A thread needs two real user accounts on it. A ClientProfile created by a pro
// — hand-added or CSV-imported — has no `userId` until the client claims it, so
// there is nobody to deliver a message to. `resolveMessageThread` enforces that
// with a 409 CLIENT_UNCLAIMED.
//
// The predicate lives here because BOTH sides need the same answer: the resolve
// route refusing, and the pro booking detail deciding whether to offer a
// "Message client" affordance at all. Native clients cannot re-derive it — the
// wire never carried the client's `userId`, and it must not start to (it is PII
// the pro has no need for). Exposing the capability instead of the raw fact also
// means a future rule (blocked client, closed account…) lands in one place.

/** The subset of a ClientProfile this decision needs. */
export type ClientThreadEligibilityInput = {
  /** null / undefined until the client claims the account the pro created. */
  userId: string | null | undefined
}

/**
 * Whether a thread can be opened with this client. False for an unclaimed
 * profile, which `resolveMessageThread` answers with 409 CLIENT_UNCLAIMED.
 *
 * Written as a type predicate so the resolve path keeps its narrowing: past
 * this guard the caller has a real `userId` to build participants from, with no
 * second null-check to fall out of sync with this one.
 */
export function clientCanBeMessaged<T extends ClientThreadEligibilityInput>(
  client: T | null | undefined,
): client is T & { userId: string } {
  return Boolean(client?.userId)
}
