// app/api/public/account-invite/[token]/route.ts
//
// Public, no-auth endpoint for the consultation/aftercare magic-link pages.
// The caller holds a valid ClientActionToken (consultation OR aftercare). When
// the bound client is still UNCLAIMED, we mint a fresh claim link so the soft
// "create an account" CTA can route them through the existing /claim flow with
// their profile + history carried over.

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { issueClaimLinkForBooking } from '@/lib/clients/clientClaimLinks'
import { hashClientActionToken } from '@/lib/consultation/clientActionTokens'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _request: Request,
  ctx: RouteContext<{ token: string }>,
) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = pickString(params?.token)

    if (!rawToken) {
      return jsonFail(404, 'Link not found.', { code: 'NOT_FOUND' })
    }

    const tokenHash = hashClientActionToken(rawToken)

    const actionToken = await prisma.clientActionToken.findUnique({
      where: { tokenHash },
      select: { id: true, bookingId: true, revokedAt: true },
    })

    if (!actionToken || !actionToken.bookingId) {
      return jsonFail(404, 'Link not found.', { code: 'NOT_FOUND' })
    }

    if (actionToken.revokedAt) {
      return jsonFail(409, 'This link is no longer active.', {
        code: 'REVOKED',
      })
    }

    const result = await issueClaimLinkForBooking({
      bookingId: actionToken.bookingId,
    })

    switch (result.kind) {
      case 'ok':
        return jsonOk(
          { claimUrl: `/claim/${encodeURIComponent(result.rawToken)}` },
          200,
        )
      case 'already_claimed':
        // Profile already has an account — CTA should hide itself.
        return jsonOk({ claimUrl: null, alreadyClaimed: true }, 200)
      case 'revoked':
        return jsonFail(409, 'Account setup is not available for this link.', {
          code: 'REVOKED',
        })
      case 'not_found':
      default:
        return jsonFail(404, 'Link not found.', { code: 'NOT_FOUND' })
    }
  } catch (error) {
    console.error('POST /api/public/account-invite/[token] error', error)
    return jsonFail(500, 'Internal server error')
  }
}
