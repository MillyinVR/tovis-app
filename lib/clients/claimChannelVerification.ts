// lib/clients/claimChannelVerification.ts
//
// "The click IS the verification": a claim link opened from the email it was
// delivered to proves control of that email; opened from the SMS, of that
// phone. This module turns a signature-proven delivery channel
// (lib/clients/claimLinkChannel) into a verification stamp
// (lib/auth/contactVerification) — but ONLY when the account claiming is
// reachable at the very contact the message went to, so a link forwarded to
// someone else never verifies a contact they don't hold.
//
// The credit is independent of whether the claim itself commits: eligibility
// already requires the acting account's own contact to equal the invite's
// delivery destination. A revoked invite gets no credit — the pro pulled that
// link, so nothing is extended from it.

import { ContactMethod, ProClientInviteStatus, Role } from '@prisma/client'

import {
  markUserEmailVerified,
  markUserPhoneVerified,
} from '@/lib/auth/contactVerification'
import { prisma } from '@/lib/prisma'
import {
  normalizeEmail,
  normalizePhone,
} from '@/lib/security/contactNormalization'

import { getClientClaimLinkByToken } from './clientClaimLinks'

/**
 * Whether the given contact pair is reachable at the invite's delivery
 * destination for `channel`. Both sides are normalized here, so callers can
 * pass raw stored values.
 */
export function matchesClaimChannelContact(args: {
  channel: ContactMethod
  invitedEmail: string | null
  invitedPhone: string | null
  email: string | null
  phone: string | null
}): boolean {
  if (args.channel === ContactMethod.EMAIL) {
    const invited = normalizeEmail(args.invitedEmail)
    const own = normalizeEmail(args.email) // pii-plaintext-read-ok: compares the acting account's OWN email against the invite's delivery destination — this equality IS the authorization for crediting the channel; neither value is logged or returned
    return invited != null && own != null && invited === own
  }

  const invited = normalizePhone(args.invitedPhone)
  const own = normalizePhone(args.phone) // pii-plaintext-read-ok: compares the acting account's OWN phone against the invite's delivery destination — this equality IS the authorization for crediting the channel; neither value is logged or returned
  return invited != null && own != null && invited === own
}

/**
 * Credit a signature-proven claim-link click as verification of the delivery
 * channel, for an EXISTING signed-in user. Loads the invite by token, requires
 * the user's own contact to match the invite's destination for that channel,
 * and stamps idempotently. Returns true when the credit applied (or was
 * already in place), false when anything disqualified it. Never throws for a
 * disqualified credit — this is an upgrade, not a gate.
 */
export async function applyClaimLinkChannelVerification(args: {
  token: string
  channel: ContactMethod
  user: {
    id: string
    role: Role
    email: string | null
    phone: string | null
  }
}): Promise<boolean> {
  const invite = await getClientClaimLinkByToken({ token: args.token })

  if (!invite) return false
  if (invite.status === ProClientInviteStatus.REVOKED || invite.revokedAt != null) {
    return false
  }

  if (
    !matchesClaimChannelContact({
      channel: args.channel,
      invitedEmail: invite.invitedEmail,
      invitedPhone: invite.invitedPhone,
      email: args.user.email,
      phone: args.user.phone,
    })
  ) {
    return false
  }

  const verifiedAt = new Date()

  await prisma.$transaction(async (tx) => {
    if (args.channel === ContactMethod.EMAIL) {
      await markUserEmailVerified(tx, {
        userId: args.user.id,
        verifiedAt,
      })
    } else {
      await markUserPhoneVerified(tx, {
        userId: args.user.id,
        role: args.user.role,
        verifiedAt,
      })
    }
  })

  return true
}
