// lib/notifications/contactMethod.ts
//
// Which channel a client action link should prefer, given what we can actually
// reach them on.
//
// Extracted at K15 rather than copied a fourth time. There were THREE identical
// bodies (lib/booking/writeBoundary.ts, the consultation-proposal route, and
// lib/booking/createProBookingWithClient.ts) and they had already DRIFTED: the
// pro-create copy takes no `existingPreference` at all and never selects the
// column, so it can only ever infer. That difference is a behaviour question,
// not a tidiness one, so it is recorded rather than silently unified here —
// consolidating it would change what a pro-created client's claim invite picks
// ([[drifted-duplicate-is-a-bug-report]]).

import { ContactMethod } from '@prisma/client'

/**
 * The client's own stored preference wins. Failing that, a client we can only
 * reach ONE way is reached that way; a client reachable both ways gets no
 * preference here and falls through to the action's own default (the registry's
 * `preferredContactMethod`).
 */
export function inferPreferredContactMethod(args: {
  email: string | null
  phone: string | null
  existingPreference?: ContactMethod | null | undefined
}): ContactMethod | null {
  if (args.existingPreference) return args.existingPreference
  // Presence checks only — neither value is read, stored or logged here; this
  // decides WHICH CHANNEL a link goes out on.
  if (args.email && !args.phone) return ContactMethod.EMAIL // pii-plaintext-read-ok: presence check only
  if (args.phone && !args.email) return ContactMethod.SMS // pii-plaintext-read-ok: presence check only
  return null
}

/** The first value that is a non-blank string, trimmed. */
export function pickFirstNonEmptyContact(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) return normalized
  }
  return null
}
