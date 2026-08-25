// app/api/_utils/claimInviteRefusals.ts
//
// The two refusals both pro-facing claim-invite doors share, in one place.
//
// `issueClaimLinkFor*` refuses in exactly two ways that are not about WHICH
// door you came through — the client already claimed their profile, or the pro
// revoked the link. Both doors answered with byte-identical copy and codes
// after #988, in two files. Copy that is meant to be the same and is stored
// twice is copy that drifts: a reworded message on one door reads as a
// different failure on the other, to a caller that cannot tell them apart.
//
// `not_found` is deliberately NOT here — it is door-specific ("Booking not
// found." vs "Client not found.") and each route answers it itself.

import { jsonFail } from './responses'

/** The issuer refusals that mean the same thing at every door. */
export type ClaimLinkRefusalKind = 'already_claimed' | 'revoked'

const REFUSALS: Record<
  ClaimLinkRefusalKind,
  { message: string; code: string }
> = {
  already_claimed: {
    message: 'This client has already been claimed.',
    code: 'ALREADY_CLAIMED',
  },
  revoked: {
    message: 'This client’s claim link was revoked.',
    code: 'REVOKED',
  },
}

/**
 * A 409 for a claim link that cannot be issued. Both are conflicts with durable
 * state the caller cannot retry past — never a 400, and never a 200 that
 * quietly sent nothing.
 */
export function claimLinkRefusalResponse(kind: ClaimLinkRefusalKind): Response {
  const refusal = REFUSALS[kind]
  return jsonFail(409, refusal.message, { code: refusal.code })
}
