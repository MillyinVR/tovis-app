// app/api/v1/pro/invites/[token]/accept/route.ts

import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { acceptClientClaimFromLink } from '@/lib/clients/clientClaim'
import { normalizeProClientInviteToken } from '@/lib/clients/proClientInviteTokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _request: Request,
  ctx: RouteContext<{ token: string }>,
) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const params = await resolveRouteParams(ctx)
    const token = normalizeProClientInviteToken(params?.token)

    if (!token) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    const result = await acceptClientClaimFromLink({
      token,
      actingUserId: auth.user.id,
      actingClientId: auth.clientId,
    })

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

    if (result.kind === 'client_not_found') {
      return jsonFail(404, 'Client profile not found.', {
        code: 'CLIENT_NOT_FOUND',
      })
    }

    if (result.kind === 'client_mismatch') {
      return jsonFail(409, 'Invite does not belong to this client.', {
        code: 'CLIENT_MISMATCH',
      })
    }

    if (result.kind === 'conflict') {
      return jsonFail(409, 'Invite could not be claimed.', {
        code: 'CONFLICT',
      })
    }

    return jsonOk({ bookingId: result.bookingId }, 200)
  } catch (error) {
    console.error('POST /api/v1/pro/invites/[token]/accept error', error)
    return jsonFail(500, 'Internal server error')
  }
}