// lib/clientActions/queueClaimInviteDelivery.ts
//
// The one way a pro-facing route hands a freshly issued claim link to the
// notification drain.
//
// There are two such doors — POST /pro/bookings/[id]/invite and
// POST /pro/clients/[id]/invite — and after #988 gave the booking door the
// booking-less door's contract they were near-twins: the same fourteen-field
// call, the same `created ? INITIAL_SEND : RESEND` decision, the same
// {attempted, queued, href} summary, the same try/catch. Twins that are edited
// separately are how the original bug survived in the first place: the two
// doors were *supposed* to behave alike, one of them was fixed, and nothing
// made the other follow.
//
// 🔴 The `resendMode` line is the load-bearing one, and it is why this lives in
// ONE place. Every issuance mints a fresh token, so a re-issue has already
// invalidated the link that was delivered before. `INITIAL_SEND` discards
// `sendVersion`, so a re-issue sent that way collapses into the first send's
// `NotificationDispatch.sourceKey` (@unique) and queues nothing at all — the
// client holds a dead link, is promised a live one, and has neither. Getting
// this wrong is strictly worse than not sending.

import type { ContactMethod } from '@prisma/client'

import { asTrimmedString } from '@/lib/guards'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import type { TenantContext } from '@/lib/tenant/context'

import { createClientClaimInviteDelivery } from './createClientClaimInviteDelivery'

export type ClaimInviteDeliverySummary = {
  /** A send was tried. False when there was nothing to deliver to. */
  attempted: boolean
  /** A NEW dispatch entered the queue. False for a collapse or a failure. */
  queued: boolean
  /** The claim link that went out, or null when nothing did. */
  href: string | null
}

/** Nothing was delivered, and nothing was attempted. */
export const NO_CLAIM_INVITE_DELIVERY: ClaimInviteDeliverySummary = {
  attempted: false,
  queued: false,
  href: null,
}

export type QueueClaimInviteDeliveryArgs = {
  /** Route label for the log line, e.g. 'POST /api/v1/pro/clients/[id]/invite'. */
  route: string

  tenantContext: TenantContext
  professionalId: string | null
  clientId: string
  bookingId: string | null
  inviteId: string
  rawToken: string

  invitedName: string
  invitedEmail: string | null
  invitedPhone: string | null
  preferredContactMethod: ContactMethod | null

  issuedByUserId: string | null
  recipientUserId: string | null

  /**
   * False when the claim token was ROTATED on an existing invite row
   * (`issueClaimLinkFor*` reports this). See the header: it decides the send
   * cycle, and getting it wrong delivers nothing.
   */
  created: boolean
}

/**
 * Queue the claim link for delivery, and report honestly what happened.
 *
 * Never throws: a delivery failure must not fail the pro's request, because the
 * raw token still rides the response and the pro can share the link by hand.
 * The summary is what the route tells them — so it reports the dispatch's own
 * `created` flag rather than assuming a send happened.
 */
export async function queueClaimInviteDelivery(
  args: QueueClaimInviteDeliveryArgs,
): Promise<ClaimInviteDeliverySummary> {
  // Nothing to deliver to. A contactless client still gets a link the pro can
  // share manually, which is returned by the caller either way.
  if (!args.invitedEmail && !args.invitedPhone) {
    return NO_CLAIM_INVITE_DELIVERY
  }

  try {
    const delivery = await createClientClaimInviteDelivery({
      tenantContext: args.tenantContext,
      professionalId: args.professionalId,
      clientId: args.clientId,
      bookingId: args.bookingId,
      inviteId: args.inviteId,
      rawToken: args.rawToken,
      invitedName: args.invitedName,
      invitedEmail: args.invitedEmail,
      invitedPhone: args.invitedPhone,
      preferredContactMethod: args.preferredContactMethod,
      issuedByUserId: args.issuedByUserId,
      recipientUserId: args.recipientUserId,
      resendMode: args.created ? 'INITIAL_SEND' : 'RESEND',
    })

    return {
      attempted: true,
      queued: delivery.dispatch.created,
      href: delivery.link.href,
    }
  } catch (error: unknown) {
    console.error(`${args.route} delivery enqueue failed`, {
      error: safeError(error),
      meta: safeLogMeta({
        route: args.route,
        professionalId: asTrimmedString(args.professionalId),
        bookingId: asTrimmedString(args.bookingId),
        clientId: args.clientId,
        inviteId: args.inviteId,
      }),
    })

    return { attempted: true, queued: false, href: null }
  }
}
