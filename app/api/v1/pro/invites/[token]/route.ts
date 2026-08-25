// app/api/v1/pro/invites/[token]/route.ts

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  enforceRateLimit,
  rateLimitIdentity,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import { getClientClaimLinkPublicState } from '@/lib/clients/clientClaimLinks'
import {
  hashProClientInviteToken,
  normalizeProClientInviteToken,
} from '@/lib/clients/proClientInviteTokens'

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

    // Brute-force guard: cap by IP and by token-hash prefix BEFORE any DB
    // lookup. This route reads the SAME claim-link state as
    // /api/v1/public/claim/[token] (same helper, same token space) and returns
    // strictly more of it — invitedEmail/invitedPhone included — so it must
    // carry the same ceilings. Deliberately the same buckets as that route, not
    // parallel ones: sharing the counters stops an unauthenticated caller
    // doubling its budget by alternating between the two endpoints.
    const ipLimited = await enforceRateLimit({
      bucket: 'account-invite:mint',
      identity: await rateLimitIdentity(),
    })
    if (ipLimited) return ipLimited

    const tokenLimited = await enforceRateLimit({
      bucket: 'account-invite:mint:token',
      identity: tokenRateLimitIdentity(
        hashProClientInviteToken(token).slice(0, 16),
      ),
    })
    if (tokenLimited) return tokenLimited

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
    console.error('GET /api/v1/pro/invites/[token] error', error)
    return jsonFail(500, 'Internal server error')
  }
}