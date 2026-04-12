import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import { acceptProClientClaimLink } from '@/lib/claims/proClientClaim'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: { token: string } | Promise<{ token: string }> }

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const params = await Promise.resolve(ctx.params)
    const token = asTrimmedString(params?.token)

    if (!token) {
      return jsonFail(404, 'Invite not found.', { code: 'NOT_FOUND' })
    }

    const result = await acceptProClientClaimLink({
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
    console.error('POST /api/pro/invites/[token]/accept error', error)
    return jsonFail(500, 'Internal server error')
  }
}