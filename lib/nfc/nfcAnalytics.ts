// lib/nfc/nfcAnalytics.ts
//
// Aggregates the NFC card funnel for the admin analytics surface. Reads only
// existing data (AttributionEvent + Referral); no per-booking NFC attribution
// field exists yet, so "conversions" are measured via referrals that produced a
// booking (Referral.convertedAt / triggerBookingId).

import { NfcCardType, Prisma, ReferralStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { NFC_ATTRIBUTION_EVENT } from './attributionEvents'

export type NfcFunnelSummary = {
  /** Real human taps recorded (funnel top). */
  taps: number
  /** Unclaimed cards claimed (new account/owner). */
  signups: number
  /** Taps that landed on an already-claimed card. */
  existingCardTaps: number
  /** Claims lost to a concurrent tapper. */
  raceLost: number
  /** White-label taps rejected for a home-tenant mismatch. */
  tenantMismatch: number
  /** Referrals attributed to a card. */
  referralsCreated: number
  /** Referrals the referrer acknowledged/linked. */
  referralsConfirmed: number
  /** Referrals that produced a booking. */
  referralsConverted: number
}

export type NfcCardStat = {
  cardId: string
  shortCode: string
  type: NfcCardType
  isActive: boolean
  taps: number
  signups: number
  referralCount: number
}

export type NfcAnalytics = {
  summary: NfcFunnelSummary
  topCards: NfcCardStat[]
}

type NfcAnalyticsDb = Pick<
  Prisma.TransactionClient,
  'attributionEvent' | 'referral' | 'nfcCard'
>

// ReferralStatus values that mean the referrer linked/honored the referral.
const CONFIRMED_REFERRAL_STATUSES: ReferralStatus[] = [
  ReferralStatus.CONFIRMED,
  ReferralStatus.CONVERTED,
  ReferralStatus.REWARDED,
]

async function getEventCountsByType(
  db: NfcAnalyticsDb,
): Promise<Map<string, number>> {
  const rows = await db.attributionEvent.groupBy({
    by: ['eventType'],
    _count: { _all: true },
  })

  return new Map(rows.map((row) => [row.eventType, row._count._all]))
}

async function getTopCardStats(
  db: NfcAnalyticsDb,
  topN: number,
): Promise<NfcCardStat[]> {
  const rows = await db.attributionEvent.groupBy({
    by: ['cardId', 'eventType'],
    where: { cardId: { not: null } },
    _count: { _all: true },
  })

  const perCard = new Map<string, { taps: number; signups: number }>()

  for (const row of rows) {
    if (!row.cardId) continue
    const entry = perCard.get(row.cardId) ?? { taps: 0, signups: 0 }
    if (row.eventType === NFC_ATTRIBUTION_EVENT.CARD_TAPPED) {
      entry.taps += row._count._all
    } else if (row.eventType === NFC_ATTRIBUTION_EVENT.CARD_CLAIMED) {
      entry.signups += row._count._all
    }
    perCard.set(row.cardId, entry)
  }

  const topCardIds = [...perCard.entries()]
    .sort((a, b) => b[1].taps - a[1].taps || b[1].signups - a[1].signups)
    .slice(0, topN)
    .map(([cardId]) => cardId)

  if (topCardIds.length === 0) return []

  const cards = await db.nfcCard.findMany({
    where: { id: { in: topCardIds } },
    select: {
      id: true,
      shortCode: true,
      type: true,
      isActive: true,
      referralCount: true,
    },
  })

  const cardById = new Map(cards.map((card) => [card.id, card]))

  return topCardIds.flatMap((cardId) => {
    const card = cardById.get(cardId)
    const counts = perCard.get(cardId)
    if (!card || !counts) return []
    return [
      {
        cardId,
        shortCode: card.shortCode,
        type: card.type,
        isActive: card.isActive,
        taps: counts.taps,
        signups: counts.signups,
        referralCount: card.referralCount,
      },
    ]
  })
}

export async function getNfcAnalytics(args?: {
  db?: NfcAnalyticsDb
  topN?: number
}): Promise<NfcAnalytics> {
  const db = args?.db ?? prisma
  const topN = args?.topN ?? 20

  const cardFilter: Prisma.ReferralWhereInput = { nfcCardId: { not: null } }

  const [
    eventCounts,
    referralsCreated,
    referralsConfirmed,
    referralsConverted,
    topCards,
  ] = await Promise.all([
    getEventCountsByType(db),
    db.referral.count({ where: cardFilter }),
    db.referral.count({
      where: { ...cardFilter, status: { in: CONFIRMED_REFERRAL_STATUSES } },
    }),
    db.referral.count({
      where: { ...cardFilter, convertedAt: { not: null } },
    }),
    getTopCardStats(db, topN),
  ])

  return {
    summary: {
      taps: eventCounts.get(NFC_ATTRIBUTION_EVENT.CARD_TAPPED) ?? 0,
      signups: eventCounts.get(NFC_ATTRIBUTION_EVENT.CARD_CLAIMED) ?? 0,
      existingCardTaps:
        eventCounts.get(NFC_ATTRIBUTION_EVENT.TAP_EXISTING_CARD) ?? 0,
      raceLost: eventCounts.get(NFC_ATTRIBUTION_EVENT.CLAIM_RACE_LOST) ?? 0,
      tenantMismatch:
        eventCounts.get(NFC_ATTRIBUTION_EVENT.CLAIM_TENANT_MISMATCH) ?? 0,
      referralsCreated,
      referralsConfirmed,
      referralsConverted,
    },
    topCards,
  }
}
