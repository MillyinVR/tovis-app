// lib/clients/selfServeClaim.ts
//
// Cold self-serve claim. When someone tries a NORMAL client signup (no claim
// link) with an email/phone that matches an existing UNCLAIMED ClientProfile,
// register would dead-end on P2002 -> ACCOUNT_EXISTS (the unclaimed profile owns
// the unique emailHashV2/phoneHashV2 slots and there's no User to log into).
//
// Instead we detect the match and send a claim link to the profile's ON-FILE
// contact, routing the person through the shipped /claim adopt flow. Receiving
// that link proves control of the contact (the authorization), and the message
// only ever goes to the contact already on file — never an attacker-supplied one.

import { ClientClaimStatus } from '@prisma/client'

import { maskPhone } from '@/lib/auth/verification'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { prisma } from '@/lib/prisma'
import {
  buildEmailLookupHashV2ForContactInput,
  buildPhoneLookupHashV2ForContactInput,
} from '@/lib/security/contactLookup'
import type { TenantContext } from '@/lib/tenant/context'

import {
  issueClaimLinkForBooking,
  issueClaimLinkForClient,
} from './clientClaimLinks'
import { buildClientProfileLookupOrConditions } from './upsertProClient'

export type SelfServeClaimableProfile = {
  clientId: string
  /**
   * The profile's most recent booking, or null for a booking-less profile
   * (directory-created / migration-imported). The sender mints a booking-bearing
   * claim link when present, else a booking-less one.
   */
  bookingId: string | null
  /**
   * A masked hint (e.g. "t***@example.com and ********4567") built ONLY from the
   * registering contact the caller already typed, for the channels that matched
   * the on-file profile — so it reveals nothing the user didn't already provide.
   */
  maskedDestination: string | null
}

/**
 * Mask an email to a first-char + domain hint: `tori@example.com` -> `t***@example.com`.
 */
function maskEmail(email: string): string {
  const trimmed = email.trim()
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return '***'

  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at)
  const head = local.slice(0, 1)

  return `${head}***${domain}`
}

/**
 * Find an UNCLAIMED, unowned ClientProfile whose email or phone matches the
 * registering contact. Returns null when there's no match or an ambiguous
 * multi-profile match — the caller should fall back to normal registration. A
 * matched profile with no booking is still claimable (booking-less link).
 *
 * Only lookup HASHES are read from the profile (never plaintext email/phone); the
 * masked hint is derived from the caller's own already-typed contact.
 */
export async function findSelfServeClaimableProfile(args: {
  email: string | null
  phone: string | null
}): Promise<SelfServeClaimableProfile | null> {
  const orConditions = buildClientProfileLookupOrConditions({
    email: args.email,
    phone: args.phone,
  })

  if (orConditions.length === 0) {
    return null
  }

  const profiles = await prisma.clientProfile.findMany({
    where: {
      userId: null,
      claimStatus: ClientClaimStatus.UNCLAIMED,
      OR: orConditions,
    },
    select: {
      id: true,
      emailHashV2: true,
      emailHashKeyVersion: true,
      phoneHashV2: true,
      phoneHashKeyVersion: true,
    },
    take: 2,
  })

  // No match, or an ambiguous match where email and phone resolve to different
  // unclaimed profiles — bail to normal registration rather than guess.
  if (profiles.length !== 1) {
    return null
  }

  const profile = profiles[0]
  if (!profile) {
    return null
  }

  // A booking is preferred (its context enriches the claim link) but not
  // required — a booking-less profile still gets a booking-less claim link.
  const booking = await prisma.booking.findFirst({
    where: { clientId: profile.id },
    orderBy: { scheduledFor: 'desc' },
    select: { id: true },
  })

  const emailHash = buildEmailLookupHashV2ForContactInput(args.email) // pii-plaintext-read-ok: hashes the caller's own registering email into the security blind index to identify the matched channel (no DB PII read), mirrors upsertProClient
  const phoneHash = buildPhoneLookupHashV2ForContactInput(args.phone) // pii-plaintext-read-ok: hashes the caller's own registering phone into the security blind index to identify the matched channel (no DB PII read), mirrors upsertProClient

  const matchedEmail = Boolean(
    emailHash &&
      profile.emailHashV2 === emailHash.hash &&
      profile.emailHashKeyVersion === emailHash.keyVersion,
  )
  const matchedPhone = Boolean(
    phoneHash &&
      profile.phoneHashV2 === phoneHash.hash &&
      profile.phoneHashKeyVersion === phoneHash.keyVersion,
  )

  const maskedParts: string[] = []
  if (matchedEmail && args.email) maskedParts.push(maskEmail(args.email)) // pii-plaintext-read-ok: redacts the caller's OWN already-typed email for a check-inbox hint; reveals nothing they didn't provide, no DB read
  if (matchedPhone && args.phone) maskedParts.push(maskPhone(args.phone)) // pii-plaintext-read-ok: redacts the caller's OWN already-typed phone for a check-inbox hint; reveals nothing they didn't provide, no DB read

  return {
    clientId: profile.id,
    bookingId: booking?.id ?? null,
    maskedDestination: maskedParts.join(' and ') || null,
  }
}

/**
 * Mint a claim link for the matched profile and deliver it to the client's
 * on-file contact (email/SMS) via the existing CLIENT_CLAIM_INVITE pipeline,
 * then kick the notification drain. Mints a booking-bearing link when the
 * profile has a booking, else a pro-less booking-less link. Returns
 * `{ sent: false }` if the profile turned out to be claimed/revoked between
 * detection and send.
 */
export async function sendSelfServeClaimLink(args: {
  clientId: string
  bookingId: string | null
  tenantContext: TenantContext
}): Promise<{ sent: boolean }> {
  const issued = args.bookingId
    ? await issueClaimLinkForBooking({ bookingId: args.bookingId })
    : await issueClaimLinkForClient({
        clientId: args.clientId,
        professionalId: null,
      })

  if (issued.kind !== 'ok') {
    return { sent: false }
  }

  const invite = issued.invite

  await createClientClaimInviteDelivery({
    professionalId: invite.professionalId,
    clientId: invite.clientId,
    bookingId: invite.bookingId,
    inviteId: invite.id,
    rawToken: issued.rawToken,
    tenantContext: args.tenantContext,
    invitedName: invite.invitedName,
    invitedEmail: invite.invitedEmail,
    invitedPhone: invite.invitedPhone,
    preferredContactMethod: invite.preferredContactMethod,
    recipientUserId: null,
  })

  kickNotificationDrain()

  return { sent: true }
}
