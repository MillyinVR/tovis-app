// lib/referral/inviteCard.ts
//
// The client's shareable digital referral link. Deliberately NOT a parallel
// system: the link is the client's own CLIENT_REFERRAL NfcCard (minted here
// as a "virtual card" if they don't hold one yet), shared as /c/{shortCode}.
// A click therefore rides the exact same spine as a physical tap —
// /c → /t → TapIntent → consumeTapIntent on signup/login → PENDING Referral
// → pro-configured reward at booking — one code path, one audit trail, and a
// future physical card for the same client just works.
import { NfcCardType, Prisma } from '@prisma/client'

import { formatShortCode, generateShortCode } from '@/lib/nfcShortCode'
import { isUniqueConstraintError } from '@/lib/prismaErrors'
import { prisma } from '@/lib/prisma'

export type ClientInviteCard = {
  cardId: string
  shortCode: string
  /** TOV-XXXX-XXXX display form. */
  shortCodeDisplay: string
  /** Root-relative share path (resolves through /c → /t). */
  path: string
}

const CREATE_ATTEMPTS = 10

function toInviteCard(card: { id: string; shortCode: string }): ClientInviteCard {
  return {
    cardId: card.id,
    shortCode: card.shortCode,
    shortCodeDisplay: formatShortCode(card.shortCode),
    path: `/c/${card.shortCode}`,
  }
}

export async function getOrCreateClientInviteCard(args: {
  userId: string
  clientId: string
}): Promise<ClientInviteCard> {
  const existing = await prisma.nfcCard.findFirst({
    where: {
      claimedByUserId: args.userId,
      type: NfcCardType.CLIENT_REFERRAL,
      isActive: true,
    },
    orderBy: { claimedAt: 'desc' },
    select: { id: true, shortCode: true },
  })

  if (existing) return toInviteCard(existing)

  // Tenant follows the client's home tenant, mirroring the claim rule in
  // consumeTapIntent (a card and its claimer always share a tenant).
  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: { homeTenantId: true },
  })

  if (!clientProfile) {
    throw new Error('getOrCreateClientInviteCard: client profile not found')
  }

  const claimedAt = new Date()

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const shortCode = generateShortCode(8)

    try {
      const created = await prisma.nfcCard.create({
        data: {
          type: NfcCardType.CLIENT_REFERRAL,
          isActive: true,
          tenantId: clientProfile.homeTenantId,
          claimedAt,
          claimedByUserId: args.userId,
          shortCode,
        } satisfies Prisma.NfcCardUncheckedCreateInput,
        select: { id: true, shortCode: true },
      })

      return toInviteCard(created)
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) continue
      throw error
    }
  }

  throw new Error(
    'getOrCreateClientInviteCard: failed to generate a unique short code',
  )
}
