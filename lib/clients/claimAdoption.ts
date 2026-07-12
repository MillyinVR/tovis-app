// lib/clients/claimAdoption.ts
//
// Claim-link signup adoption. When someone registers through a pro-sent claim
// link (/claim/[token] -> /signup?intent=CLAIM_INVITE&inviteToken=...), the real
// person should TAKE OWNERSHIP of the pre-existing UNCLAIMED ClientProfile the pro
// created — preserving its bookings, aftercare, addresses, and contact — instead
// of minting a duplicate profile that would collide on the unique contact hashes
// (ClientProfile.emailHashV2 / phoneHashV2), which is what dead-ends the flow today
// with ACCOUNT_EXISTS.
//
// This runs INSIDE the register transaction (app/api/v1/auth/register/route.ts). It
// is gated by the registering email OR phone matching the invite's on-file contact
// — a stronger authorization signal than a bare verified account, and the reason no
// duplicate is created (we adopt the profile that already owns those hashes).

import {
  ClientClaimStatus,
  Prisma,
  ProClientInviteStatus,
} from '@prisma/client'

import {
  normalizeEmail,
  normalizePhone,
} from '@/lib/security/contactNormalization'

import {
  getClientClaimLinkByToken,
  markClientClaimLinkAcceptedAudit,
} from './clientClaimLinks'
import { normalizeProClientInviteToken } from './proClientInviteTokens'

export type AdoptClaimInviteDuringRegistrationArgs = {
  tx: Prisma.TransactionClient
  /** Raw claim invite token from the signup querystring (inviteToken). */
  token: string | null
  /** The freshly-created User id that should own the claimed profile. */
  userId: string
  /** Already-normalized registering contact (as stored on the new User). */
  registeredEmail: string | null
  registeredPhone: string | null
  now: Date
}

export type AdoptClaimInviteReason =
  | 'no_token'
  | 'not_found'
  | 'revoked'
  | 'already_claimed'
  | 'contact_mismatch'
  | 'lost_race'

export type AdoptClaimInviteDuringRegistrationResult =
  | { adopted: true; clientId: string }
  | { adopted: false; reason: AdoptClaimInviteReason }

function contactMatchesInvite(args: {
  registeredEmail: string | null
  registeredPhone: string | null
  invitedEmail: string | null
  invitedPhone: string | null
}): boolean {
  const invitedEmail = normalizeEmail(args.invitedEmail)
  const invitedPhone = normalizePhone(args.invitedPhone)

  const emailMatches =
    args.registeredEmail != null &&
    invitedEmail != null &&
    args.registeredEmail === invitedEmail

  const phoneMatches =
    args.registeredPhone != null &&
    invitedPhone != null &&
    args.registeredPhone === invitedPhone

  return emailMatches || phoneMatches
}

/**
 * Attempt to adopt (claim) the unclaimed ClientProfile referenced by a claim
 * invite during registration. Returns `{ adopted: true, clientId }` when the new
 * user was linked to and claimed the existing profile, otherwise `{ adopted:
 * false, reason }` and the caller should fall back to creating a fresh profile.
 *
 * The claim is guarded (updateMany on `userId: null, claimStatus: UNCLAIMED`) and
 * the `ClientProfile.userId @unique` constraint makes concurrent adoption safe: a
 * second racer's update matches zero rows -> `lost_race`.
 */
export async function adoptClaimInviteDuringRegistration(
  args: AdoptClaimInviteDuringRegistrationArgs,
): Promise<AdoptClaimInviteDuringRegistrationResult> {
  const token = normalizeProClientInviteToken(args.token)
  if (!token) {
    return { adopted: false, reason: 'no_token' }
  }

  const invite = await getClientClaimLinkByToken({ token, tx: args.tx })

  if (!invite || !invite.client) {
    return { adopted: false, reason: 'not_found' }
  }

  if (
    invite.status === ProClientInviteStatus.REVOKED ||
    invite.revokedAt != null
  ) {
    return { adopted: false, reason: 'revoked' }
  }

  if (
    invite.client.userId != null ||
    invite.client.claimStatus === ClientClaimStatus.CLAIMED
  ) {
    return { adopted: false, reason: 'already_claimed' }
  }

  if (
    !contactMatchesInvite({
      registeredEmail: args.registeredEmail,
      registeredPhone: args.registeredPhone,
      invitedEmail: invite.invitedEmail,
      invitedPhone: invite.invitedPhone,
    })
  ) {
    return { adopted: false, reason: 'contact_mismatch' }
  }

  const shouldSetPreferredContactMethod =
    invite.preferredContactMethod != null &&
    invite.client.preferredContactMethod == null

  const claimUpdate = await args.tx.clientProfile.updateMany({
    where: {
      id: invite.clientId,
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
    },
    data: {
      userId: args.userId,
      claimStatus: ClientClaimStatus.CLAIMED,
      claimedAt: args.now,
      ...(shouldSetPreferredContactMethod
        ? { preferredContactMethod: invite.preferredContactMethod }
        : {}),
    },
  })

  if (claimUpdate.count !== 1) {
    return { adopted: false, reason: 'lost_race' }
  }

  // Best-effort acceptance audit — the profile is already claimed above; mirror
  // acceptClientClaimFromLink, which likewise commits the claim regardless of the
  // audit outcome. A thrown DB error rolls back the whole registration.
  await markClientClaimLinkAcceptedAudit({
    inviteId: invite.id,
    actingUserId: args.userId,
    acceptedAt: invite.acceptedAt ?? args.now,
    tx: args.tx,
  })

  return { adopted: true, clientId: invite.clientId }
}
