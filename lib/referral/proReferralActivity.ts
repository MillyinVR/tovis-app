// lib/referral/proReferralActivity.ts
//
// Read layer for the pro-facing referral viewer (outshine step-8 dark wedge /
// admin backlog item 4): the referrals credited to a pro so they can see who
// referred whom and what state each is in, and resolve credit disputes now that
// invite links + NFC cards affect money (reward discounts / credits).
//
// A Referral only carries a `professionalId` once it CONVERTS on a booking with
// that pro (see lib/referral/referralConversion.ts), so every row this loader
// returns is at least CONVERTED — pending client-to-client referrals are not the
// pro's data and never surface here. Reads only existing columns; no writes.

import { Prisma, ReferralRewardTier, ReferralStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/** Pure, DB-free shape the assembler operates on (Decimal already normalized). */
export type RawProReferral = {
  id: string
  status: ReferralStatus
  createdAt: Date
  convertedAt: Date | null
  rewardTier: ReferralRewardTier | null
  rewardValue: number | null
  rewardAppliedAt: Date | null
  referrerFirstName: string | null
  referredFirstName: string | null
  cardShortCode: string | null
}

export type ProReferralActivityRow = {
  id: string
  status: ReferralStatus
  createdAt: Date
  convertedAt: Date | null
  rewardTier: ReferralRewardTier | null
  rewardValue: number | null
  rewardApplied: boolean
  referrerName: string
  referredName: string
  cardShortCode: string | null
}

export type ProReferralActivitySummary = {
  /** Referrals that converted into a booking with this pro. */
  total: number
  /** Of those, how many have had their reward applied to a later booking. */
  rewarded: number
  /** Dollar credits actually applied (CREDIT tier only; DISCOUNT is a percent). */
  creditDollarsApplied: number
}

export type ProReferralActivity = {
  summary: ProReferralActivitySummary
  rows: ProReferralActivityRow[]
}

type ProReferralActivityDb = Pick<Prisma.TransactionClient, 'referral'>

// First names only — the minimal identifier, matching the referral-conversion
// notification copy. Both clients are the pro's own contacts (the referred
// client booked with them; the referrer earns a reward redeemable with them).
function displayName(firstName: string | null): string {
  const trimmed = firstName?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'A client'
}

export function assembleProReferralActivity(
  raw: RawProReferral[],
): ProReferralActivity {
  const rows: ProReferralActivityRow[] = raw.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt,
    convertedAt: r.convertedAt,
    rewardTier: r.rewardTier,
    rewardValue: r.rewardValue,
    rewardApplied: r.rewardAppliedAt != null,
    referrerName: displayName(r.referrerFirstName),
    referredName: displayName(r.referredFirstName),
    cardShortCode: r.cardShortCode,
  }))

  const creditDollarsApplied = rows.reduce((sum, row) => {
    if (
      row.rewardApplied &&
      row.rewardTier === ReferralRewardTier.CREDIT &&
      row.rewardValue != null
    ) {
      return sum + row.rewardValue
    }
    return sum
  }, 0)

  return {
    summary: {
      total: rows.length,
      rewarded: rows.filter((row) => row.rewardApplied).length,
      creditDollarsApplied,
    },
    rows,
  }
}

export async function loadProReferralActivity(args: {
  professionalId: string
  db?: ProReferralActivityDb
  limit?: number
}): Promise<ProReferralActivity> {
  const db = args.db ?? prisma
  const take = args.limit ?? 200

  const rows = await db.referral.findMany({
    where: { professionalId: args.professionalId },
    orderBy: [{ convertedAt: 'desc' }, { createdAt: 'desc' }],
    take,
    select: {
      id: true,
      status: true,
      createdAt: true,
      convertedAt: true,
      rewardTier: true,
      rewardValue: true,
      rewardAppliedAt: true,
      // pii-plaintext-read-ok: referrer first name for the pro's own referral viewer
      referrerClient: { select: { firstName: true } },
      // pii-plaintext-read-ok: referred client first name for the pro's own referral viewer
      referredClient: { select: { firstName: true } },
      nfcCard: { select: { shortCode: true } },
    },
  })

  return assembleProReferralActivity(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      convertedAt: row.convertedAt,
      rewardTier: row.rewardTier,
      rewardValue: row.rewardValue == null ? null : Number(row.rewardValue),
      rewardAppliedAt: row.rewardAppliedAt,
      referrerFirstName: row.referrerClient?.firstName ?? null,
      referredFirstName: row.referredClient?.firstName ?? null,
      cardShortCode: row.nfcCard?.shortCode ?? null,
    })),
  )
}
