// app/api/v1/client/referrals/invite-link/route.ts
//
// Returns (minting on first use) the client's shareable referral link — their
// own CLIENT_REFERRAL card as /c/{shortCode}. See lib/referral/inviteCard.ts.
import { jsonFail, jsonOk, requireClient } from '@/app/api/_utils'
import type { ClientInviteLinkResponseDTO } from '@/lib/dto/clientInviteLink'
import { getOrCreateClientInviteCard } from '@/lib/referral/inviteCard'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const card = await getOrCreateClientInviteCard({
      userId: auth.user.id,
      clientId: auth.clientId,
    })

    const response: ClientInviteLinkResponseDTO = {
      cardId: card.cardId,
      shortCode: card.shortCode,
      shortCodeDisplay: card.shortCodeDisplay,
      path: card.path,
    }

    return jsonOk(response)
  } catch (error: unknown) {
    console.error('GET /api/v1/client/referrals/invite-link error', error)
    return jsonFail(500, 'Failed to load your invite link.')
  }
}
