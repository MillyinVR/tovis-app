// app/api/v1/pro/clients/[id]/invite/route.ts
//
// Pro-facing claim invite for a BOOKING-LESS client. A pro who created a client
// via the directory / migration import (upsertProClient sets
// createdByProfessionalId) has no booking to invite from — this endpoint mints a
// booking-less claim link for that client and delivers it to the on-file contact.
// Gated by ENABLE_BOOKINGLESS_CLAIM (404 while off), same as the directory's
// booking-less visibility.

import { ClientClaimStatus } from '@prisma/client'

import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import {
  enforceRateLimit,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { bookinglessClaimEnabled } from '@/lib/clients/bookinglessClaimFlag'
import { issueClaimLinkForClient } from '@/lib/clients/clientClaimLinks'
import { createClientClaimInviteDelivery } from '@/lib/clientActions/createClientClaimInviteDelivery'
import { asTrimmedString } from '@/lib/guards'
import { kickNotificationDrain } from '@/lib/notifications/delivery/kickNotificationDrain'
import { prisma } from '@/lib/prisma'
import { safeError, safeLogMeta } from '@/lib/security/logging'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    // Feature-gated: while off, this endpoint doesn't exist (404), matching the
    // directory's booking-less visibility gate.
    if (!bookinglessClaimEnabled()) {
      return jsonFail(404, 'Not found.', { code: 'NOT_FOUND' })
    }

    const proId = auth.professionalId
    const params = await resolveRouteParams(ctx)
    const clientId = asTrimmedString(params?.id)

    if (!clientId) {
      return jsonFail(400, 'Missing client id.', { code: 'VALIDATION_ERROR' })
    }

    // Per-(pro,client) throttle: batch-inviting many clients is fine; one client
    // can't be spammed.
    const limited = await enforceRateLimit({
      bucket: 'pro:client-claim-invite',
      identity: tokenRateLimitIdentity(`${proId}:${clientId}`),
    })
    if (limited) return limited

    const client = await prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        userId: true,
        claimStatus: true,
        createdByProfessionalId: true,
      },
    })

    // Ownership: this pro created the client, OR has a booking with them. A
    // non-owned / missing client is an indistinguishable 404 (never reveal
    // another pro's clients).
    const ownsByCreation = client?.createdByProfessionalId === proId
    const ownsByBooking =
      client != null &&
      !ownsByCreation &&
      (await prisma.booking.count({
        where: { clientId: client.id, professionalId: proId },
      })) > 0

    if (!client || (!ownsByCreation && !ownsByBooking)) {
      return jsonFail(404, 'Client not found.', { code: 'NOT_FOUND' })
    }

    if (client.userId != null || client.claimStatus !== ClientClaimStatus.UNCLAIMED) {
      return jsonFail(409, 'This client has already been claimed.', {
        code: 'ALREADY_CLAIMED',
      })
    }

    const issued = await issueClaimLinkForClient({
      clientId: client.id,
      professionalId: proId,
    })

    if (issued.kind === 'not_found') {
      return jsonFail(404, 'Client not found.', { code: 'NOT_FOUND' })
    }
    if (issued.kind === 'already_claimed') {
      return jsonFail(409, 'This client has already been claimed.', {
        code: 'ALREADY_CLAIMED',
      })
    }
    if (issued.kind === 'revoked') {
      return jsonFail(409, 'This client’s claim link was revoked.', {
        code: 'REVOKED',
      })
    }

    const invite = issued.invite

    let inviteDelivery: {
      attempted: boolean
      queued: boolean
      href: string | null
    } = { attempted: false, queued: false, href: null }

    // Deliver only when there's a contact channel on file; a contactless client
    // still gets a link the pro can share manually (returned below).
    if (invite.invitedEmail || invite.invitedPhone) {
      try {
        const delivery = await createClientClaimInviteDelivery({
          tenantContext: await resolveTenantContextForRequest(request),
          professionalId: proId,
          clientId: invite.clientId,
          bookingId: null,
          inviteId: invite.id,
          rawToken: issued.rawToken,
          invitedName: invite.invitedName,
          invitedEmail: invite.invitedEmail,
          invitedPhone: invite.invitedPhone,
          preferredContactMethod: invite.preferredContactMethod,
          issuedByUserId: asTrimmedString(auth.user?.id),
          recipientUserId: null,
        })
        inviteDelivery = {
          attempted: true,
          queued: true,
          href: delivery.link.href,
        }
        kickNotificationDrain()
      } catch (error: unknown) {
        console.error('POST /api/v1/pro/clients/[id]/invite delivery enqueue failed', {
          error: safeError(error),
          meta: safeLogMeta({
            route: 'POST /api/v1/pro/clients/[id]/invite',
            professionalId: proId,
            clientId: invite.clientId,
            inviteId: invite.id,
          }),
        })
        inviteDelivery = { attempted: true, queued: false, href: null }
      }
    }

    return jsonOk(
      {
        invite: {
          id: invite.id,
          // Raw token so the caller can display/share the link immediately.
          token: issued.rawToken,
          status: invite.status,
          invitedName: invite.invitedName,
          invitedEmail: invite.invitedEmail,
          invitedPhone: invite.invitedPhone,
          preferredContactMethod: invite.preferredContactMethod,
        },
        inviteDelivery,
      },
      200,
    )
  } catch (error: unknown) {
    console.error('POST /api/v1/pro/clients/[id]/invite error', {
      error: safeError(error),
      meta: safeLogMeta({ route: 'POST /api/v1/pro/clients/[id]/invite' }),
    })

    return jsonFail(500, 'Internal server error')
  }
}
