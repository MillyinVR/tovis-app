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

import { ContactMethod, type Prisma } from '@prisma/client'

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

/**
 * Clients we can reach AT ALL — expressed as a WHERE, so a caller can gate a
 * control on reachability without ever selecting a contact value.
 *
 * This is the precondition every client-action delivery shares: with neither an
 * email nor a phone, `maybeCreateAftercareAccessDeliveryInBoundary` throws
 * AFTERCARE_DELIVERY_FAILED — and an unclaimed client a pro created by hand
 * (most of a real book) has neither.
 *
 * 🔴 The `user` legs are not optional. The boundary falls back from the
 * profile's contact to the linked user's, so checking only the profile would
 * report a CLAIMED client as unreachable and hide a control that works. Blank
 * strings are excluded because the boundary trims before it decides.
 */
export const reachableClientWhere = {
  OR: [
    { AND: [{ email: { not: null } }, { NOT: { email: '' } }] },
    { AND: [{ phone: { not: null } }, { NOT: { phone: '' } }] },
    // `User.email` is a REQUIRED column, so a linked user is reachable unless
    // that column is blank; `User.phone` is nullable and needs the null leg.
    { user: { NOT: { email: '' } } },
    { user: { AND: [{ phone: { not: null } }, { NOT: { phone: '' } }] } },
  ],
} satisfies Prisma.ClientProfileWhereInput

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
