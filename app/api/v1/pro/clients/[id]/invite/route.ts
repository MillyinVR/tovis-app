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
import { claimLinkRefusalResponse } from '@/app/api/_utils/claimInviteRefusals'
import { bookinglessClaimEnabled } from '@/lib/clients/bookinglessClaimFlag'
import { issueClaimLinkForClient } from '@/lib/clients/clientClaimLinks'
import { loadProClientRelationship } from '@/lib/clients/proClientRelationship'
import { queueClaimInviteDelivery } from '@/lib/clientActions/queueClaimInviteDelivery'
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

    // Ownership: this pro created the client, OR has a booking with them, OR
    // the client granted them chart access. A non-owned / missing client is an
    // indistinguishable 404 (never reveal another pro's clients).
    //
    // The clauses used to be spelled out here, and this was the ONLY place that
    // asked — pro booking creation didn't, which is how a pro could unlock any
    // client's chart by POSTing a booking for them. They now live in
    // lib/clients/proClientRelationship.ts and are shared with that path.
    const relationship = await loadProClientRelationship({
      professionalId: proId,
      clientId,
    })

    if (!relationship.established) {
      return jsonFail(404, 'Client not found.', { code: 'NOT_FOUND' })
    }

    const client = await prisma.clientProfile.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        userId: true,
        claimStatus: true,
      },
    })

    if (!client) {
      return jsonFail(404, 'Client not found.', { code: 'NOT_FOUND' })
    }

    if (client.userId != null || client.claimStatus !== ClientClaimStatus.UNCLAIMED) {
      return claimLinkRefusalResponse('already_claimed')
    }

    const issued = await issueClaimLinkForClient({
      clientId: client.id,
      professionalId: proId,
    })

    if (issued.kind === 'not_found') {
      return jsonFail(404, 'Client not found.', { code: 'NOT_FOUND' })
    }
    if (issued.kind === 'already_claimed' || issued.kind === 'revoked') {
      return claimLinkRefusalResponse(issued.kind)
    }

    const invite = issued.invite

    const inviteDelivery = await queueClaimInviteDelivery({
      route: 'POST /api/v1/pro/clients/[id]/invite',
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
      created: issued.created,
    })

    // Claim invite enqueued — deliver the email/SMS link now. Unconditional, and
    // matching the booking door: `queued: false` can also mean a dispatch row
    // already existed and has not drained yet, and the kick is what gets THAT
    // one moving. A kick with nothing due is a no-op.
    kickNotificationDrain()

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
