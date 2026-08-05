// lib/notifications/recipientNames.ts
//
// How a CLIENT is named inside a PRO-facing notification's copy.
//
// Two rules, in one place because both were about to be written twice (W2's
// `notifyWaitlistJoined` had them inline, and the waitlist write boundary now
// needs the same string for two more events):
//
//  1. The name itself comes from `resolveThreadCounterparty` — the same resolver
//     the inbox, the thread header and MESSAGE_RECEIVED use. Callers pass the
//     ClientProfile row through rather than reading the plaintext name columns
//     themselves, so name formatting has exactly one owner.
//  2. Its "unknown" fallback is *rewritten*. The resolver's fallback is the noun
//     "Client", which is right for an inbox row label and wrong in a sentence:
//     "Client left your waitlist" reads like a bug. "Someone" reads like English.

import { resolveThreadCounterparty } from '@/lib/messages/counterparty'

/** The subset of a ClientProfile row this needs. */
export type ClientNameSource = {
  firstName?: string | null
  lastName?: string | null
}

/**
 * The client's name as it should appear in a sentence addressed to their pro,
 * e.g. `${name} left your waitlist`. Falls back to "Someone" when no name is
 * resolvable (including when the row itself is missing).
 */
export function clientNameForProNotification(
  client: ClientNameSource | null | undefined,
): string {
  // `viewerIsThreadPro: true` because the PRO is who reads this copy, so the
  // counterparty being resolved is the client.
  const { title } = resolveThreadCounterparty({
    viewerIsThreadPro: true,
    client: client ?? null,
    professional: null,
  })

  return title === 'Client' ? 'Someone' : title
}
