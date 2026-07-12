// app/api/v1/public/claim/[token]/route.ts
//
// Public, no-auth read for a client claim link. The web /claim/[token] page is
// RSC-only; the native app reads the same booking context through this JSON
// endpoint to render its claim screen, then routes into signup with
// intent=CLAIM_INVITE + inviteToken (which register adopts).

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import {
  enforceRateLimit,
  rateLimitIdentity,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import {
  buildClaimLocationLabel,
  buildClaimProfessionalLabel,
  resolveClaimBookingTimeZone,
  resolveClaimProfessionalName,
} from '@/lib/clients/claimPublicView'
import { getClientClaimLinkPublicState } from '@/lib/clients/clientClaimLinks'
import {
  hashProClientInviteToken,
  normalizeProClientInviteToken,
} from '@/lib/clients/proClientInviteTokens'
import type {
  ClaimPublicViewResponseDTO,
  ClaimPublicViewState,
} from '@/lib/dto/claimPublic'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  ctx: RouteContext<{ token: string }>,
) {
  try {
    const params = await resolveRouteParams(ctx)
    const rawToken = normalizeProClientInviteToken(pickString(params?.token))

    if (!rawToken) {
      return jsonFail(404, 'Claim link not found.', { code: 'NOT_FOUND' })
    }

    // Brute-force guard: cap by IP and by token-hash prefix (so a leaked partial
    // token can't be enumerated across many IPs) BEFORE any DB lookup. Mirrors
    // the public account-invite mint buckets.
    const ipLimited = await enforceRateLimit({
      bucket: 'account-invite:mint',
      identity: await rateLimitIdentity(),
    })
    if (ipLimited) return ipLimited

    const tokenLimited = await enforceRateLimit({
      bucket: 'account-invite:mint:token',
      identity: tokenRateLimitIdentity(
        hashProClientInviteToken(rawToken).slice(0, 16),
      ),
    })
    if (tokenLimited) return tokenLimited

    const state = await getClientClaimLinkPublicState({ token: rawToken })

    if (state.kind === 'not_found') {
      return jsonFail(404, 'Claim link not found.', { code: 'NOT_FOUND' })
    }

    const link = state.link
    // A booking-less claim (directory-created / migration-imported client) has no
    // booking context — render a pro/brand-level claim instead of 404-ing.
    const booking = link.booking

    const viewState: ClaimPublicViewState =
      state.kind === 'revoked'
        ? 'revoked'
        : state.kind === 'already_claimed'
          ? 'already_claimed'
          : 'ready'

    const scheduledFor =
      booking?.scheduledFor instanceof Date
        ? booking.scheduledFor.toISOString()
        : null

    const body: ClaimPublicViewResponseDTO = {
      state: viewState,
      invitedName: link.invitedName ?? null,
      invitedEmail: link.invitedEmail ?? null,
      invitedPhone: link.invitedPhone ?? null,
      professionalName: resolveClaimProfessionalName(link),
      booking: booking
        ? {
            serviceName: booking.service?.name?.trim() || null,
            professionalName: buildClaimProfessionalLabel(booking),
            scheduledFor,
            timeZone: resolveClaimBookingTimeZone(booking),
            locationLabel: buildClaimLocationLabel(booking),
          }
        : null,
    }

    return jsonOk(body, 200)
  } catch (error) {
    console.error('GET /api/v1/public/claim/[token] error', error)
    return jsonFail(500, 'Internal server error')
  }
}
