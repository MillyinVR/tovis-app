// lib/tapIntentConsume.ts
import { prisma } from '@/lib/prisma'
import type { Role, NfcCardType } from '@prisma/client'

function safeNextUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  return s
}

export async function consumeTapIntent(args: { tapIntentId: string | null; userId: string }) {
  const { tapIntentId, userId } = args

  // Not from NFC flow, nothing to do
  if (!tapIntentId) return { ok: true as const, nextUrl: null as string | null }

  const nowUtc = new Date()

  return await prisma.$transaction(async (tx) => {
    const ti = await tx.tapIntent.findUnique({
      where: { id: tapIntentId },
      select: {
        id: true,
        cardId: true,
        userId: true,
        intentType: true,
        payloadJson: true,
        expiresAt: true,
      },
    })

    // invalid TI -> ignore gracefully (don’t brick signup)
    if (!ti) return { ok: true as const, nextUrl: null as string | null }

    // expired -> ignore gracefully
    if (ti.expiresAt.getTime() <= nowUtc.getTime()) {
      return { ok: true as const, nextUrl: null as string | null }
    }

    // attach TI to user (optional bookkeeping)
    if (!ti.userId) {
      await tx.tapIntent.update({
        where: { id: ti.id },
        data: { userId },
      })
    }

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        professionalProfile: { select: { id: true } },
        clientProfile: { select: { id: true } },
      },
    })

    if (!user) return { ok: true as const, nextUrl: null as string | null }

    const nextUrlFromPayload = safeNextUrl((ti.payloadJson as any)?.nextUrl)
    const fallbackNextUrl =
      user.role === 'ADMIN' ? '/admin' :
      user.role === 'PRO' ? '/pro/calendar' :
      '/looks'

    const nextUrl = nextUrlFromPayload ?? fallbackNextUrl

    // Load card
    const card = await tx.nfcCard.findUnique({
      where: { id: ti.cardId },
      select: {
        id: true,
        type: true,
        isActive: true,
        claimedAt: true,
        claimedByUserId: true,
        professionalId: true,
        salonSlug: true,
      },
    })

    if (!card || !card.isActive) return { ok: true as const, nextUrl }

    // Already claimed? Do not re-assign. Just log + move on.
    if (card.claimedAt) {
      await tx.attributionEvent.create({
        data: {
          eventType: 'NFC_TAP_EXISTING_CARD',
          cardId: card.id,
          actorUserId: user.id,
          creditedUserId: card.claimedByUserId ?? null,
          metaJson: { tapIntentId: ti.id, nextUrl },
        },
      })

      return { ok: true as const, nextUrl }
    }

    // Decide claim outcome based on role
    const role = user.role as Role
    let newType: NfcCardType = 'CLIENT_REFERRAL'
    let proId: string | null = null

    if (role === 'PRO') {
      newType = 'PRO_BOOKING'
      proId = user.professionalProfile?.id ?? null
    }

    // Claim the card ONLY if still unclaimed (race-safe-ish)
    const claimed = await tx.nfcCard.updateMany({
      where: { id: card.id, claimedAt: null },
      data: {
        claimedAt: nowUtc,
        claimedByUserId: user.id,
        type: newType,
        professionalId: proId, // only set for PRO
      },
    })

    // Someone else claimed it milliseconds before us
    if (claimed.count !== 1) {
      await tx.attributionEvent.create({
        data: {
          eventType: 'NFC_CLAIM_RACE_LOST',
          cardId: card.id,
          actorUserId: user.id,
          metaJson: { tapIntentId: ti.id, nextUrl },
        },
      })
      return { ok: true as const, nextUrl }
    }

    await tx.attributionEvent.create({
      data: {
        eventType: 'NFC_CARD_CLAIMED',
        cardId: card.id,
        actorUserId: user.id,
        creditedUserId: user.id,
        metaJson: {
          tapIntentId: ti.id,
          role,
          assignedType: newType,
          professionalId: proId,
          nextUrl,
        },
      },
    })

    return { ok: true as const, nextUrl }
  })
}
