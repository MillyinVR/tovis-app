// app/api/pro/invites/[token]/route.ts

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { getClientClaimLinkPublicState } from '@/lib/clients/clientClaimLinks'
import { normalizeProClientInviteToken } from '@/lib/clients/proClientInviteTokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  ctx: RouteContext<{ token: string }>,
) {
  try {
    const params = await resolveRouteParams(ctx)
    const token = normalizeProClientInviteToken(params?.token)

    if (!token) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    const result = await getClientClaimLinkPublicState({ token })

    if (result.kind === 'not_found') {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    if (result.kind === 'revoked') {
      return jsonFail(410, 'Invite is no longer available.', {
        code: 'REVOKED',
      })
    }

    if (result.kind === 'already_claimed') {
      return jsonFail(409, 'Invite already claimed.', {
        code: 'ALREADY_CLAIMED',
      })
    }

    const invite = result.link

    return jsonOk(
      {
        inviteId: invite.id,
        professionalId: invite.professionalId,
        bookingId: invite.bookingId,
        invitedName: invite.invitedName,
        invitedEmail: invite.invitedEmail,
        invitedPhone: invite.invitedPhone,
        preferredContactMethod: invite.preferredContactMethod,
      },
      200,
    )
  } catch (error) {
    console.error('GET /api/pro/invites/[token] error', error)
    return jsonFail(500, 'Internal server error')
  }
}