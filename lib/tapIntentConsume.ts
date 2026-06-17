// lib/tapIntentConsume.ts
import { prisma } from '@/lib/prisma'
import { NfcCardType, NotificationEventKey, ReferralStatus, Role } from '@prisma/client'
import { nextUrlFromPayloadJson } from '@/lib/security/safeNextUrl'
import { TOVIS_ROOT_TENANT_SLUG } from '@/lib/tenant/constants'
import { createClientNotification } from '@/lib/notifications/clientNotifications'

export async function consumeTapIntent(args: { tapIntentId: string | null; userId: string }) {
  const { tapIntentId, userId } = args

  // Not from NFC flow, nothing to do
  if (!tapIntentId) return { ok: true as const, nextUrl: null as string | null }

  const nowUtc = new Date()

  return prisma.$transaction(async (tx) => {
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
        professionalProfile: { select: { id: true, homeTenantId: true } },
        clientProfile: { select: { id: true, firstName: true, homeTenantId: true } },
      },
    })

    if (!user) return { ok: true as const, nextUrl: null as string | null }

    const payloadNext = nextUrlFromPayloadJson(ti.payloadJson)

    const fallbackNextUrl =
      user.role === Role.ADMIN ? '/admin' :
      user.role === Role.PRO ? '/pro/calendar' :
      '/looks'

    const nextUrl = payloadNext ?? fallbackNextUrl

    // If somehow the tap intent has no cardId, bail gracefully
    if (!ti.cardId) return { ok: true as const, nextUrl }

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
        tenantId: true,
        tenant: { select: { slug: true } },
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

      // CLIENT_REFERRAL tap by a different client → create a PENDING referral
      if (
        card.type === NfcCardType.CLIENT_REFERRAL &&
        user.clientProfile?.id &&
        card.claimedByUserId &&
        user.id !== card.claimedByUserId
      ) {
        await maybeCreateReferral(tx, {
          referrerUserId: card.claimedByUserId,
          referredClientId: user.clientProfile.id,
          referredFirstName: user.clientProfile.firstName ?? '',
          nfcCardId: card.id,
          nowUtc,
        })
      }

      return { ok: true as const, nextUrl }
    }

    // Tenant scope (Option A — docs/launch-readiness/tenant-isolation-audit.md):
    // a white-label (non-root) card may only be claimed by a user whose home
    // tenant matches the card's issuing tenant. Root cards stay open to anyone.
    // Mismatch is ignored gracefully (don't brick signup) and logged.
    const isRootCard = card.tenant.slug === TOVIS_ROOT_TENANT_SLUG
    const claimerHomeTenantId =
      user.professionalProfile?.homeTenantId ??
      user.clientProfile?.homeTenantId ??
      null

    if (!isRootCard && claimerHomeTenantId !== card.tenantId) {
      await tx.attributionEvent.create({
        data: {
          eventType: 'NFC_CLAIM_TENANT_MISMATCH',
          cardId: card.id,
          actorUserId: user.id,
          metaJson: {
            tapIntentId: ti.id,
            cardTenantId: card.tenantId,
            claimerHomeTenantId,
            nextUrl,
          },
        },
      })

      return { ok: true as const, nextUrl }
    }

    // Decide claim outcome based on role
    let newType: NfcCardType = NfcCardType.CLIENT_REFERRAL
    let proId: string | null = null

    if (user.role === Role.PRO) {
      newType = NfcCardType.PRO_BOOKING
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
          role: user.role,
          assignedType: newType,
          professionalId: proId,
          nextUrl,
        },
      },
    })

    return { ok: true as const, nextUrl }
  })
}

const REFERRAL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

async function maybeCreateReferral(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    referrerUserId: string
    referredClientId: string
    referredFirstName: string
    nfcCardId: string
    nowUtc: Date
  },
) {
  const referrerUser = await tx.user.findUnique({
    where: { id: args.referrerUserId },
    select: { clientProfile: { select: { id: true } } },
  })

  const referrerClientId = referrerUser?.clientProfile?.id
  if (!referrerClientId) return

  // Prevent duplicate referrals for the same pair
  const existing = await tx.referral.findFirst({
    where: {
      referrerClientId,
      referredClientId: args.referredClientId,
      status: { in: [ReferralStatus.PENDING, ReferralStatus.CONFIRMED] },
    },
    select: { id: true },
  })
  if (existing) return

  const referral = await tx.referral.create({
    data: {
      referrerClientId,
      referredClientId: args.referredClientId,
      nfcCardId: args.nfcCardId,
      status: ReferralStatus.PENDING,
      expiresAt: new Date(args.nowUtc.getTime() + REFERRAL_EXPIRY_MS),
    },
    select: { id: true },
  })

  await tx.nfcCard.update({
    where: { id: args.nfcCardId },
    data: { referralCount: { increment: 1 } },
  })

  const name = args.referredFirstName.trim() || 'Someone'

  await createClientNotification({
    clientId: referrerClientId,
    eventKey: NotificationEventKey.REFERRAL_TAP_RECEIVED,
    title: `${name} tapped your referral card`,
    body: 'Link this as a referral to earn rewards when they book.',
    href: `/client/referrals?confirm=${referral.id}`,
    dedupeKey: `REFERRAL_TAP:${referral.id}`,
    tx,
  })
}