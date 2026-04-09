// lib/lastMinute/audience/buildTier2ReactivationAudience.ts
import { BookingStatus, LastMinuteTier, Prisma } from '@prisma/client'
import {
  mergeAndDedupeRecipients,
  type LastMinuteAudienceCandidate,
  type LastMinuteDbClient,
} from './mergeAndDedupeRecipients'

export type Tier2ReactivationCandidate = LastMinuteAudienceCandidate

const openingForTier2Select = {
  id: true,
  professionalId: true,
  timeZone: true,
} satisfies Prisma.LastMinuteOpeningSelect

export type OpeningForTier2 = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingForTier2Select
}>

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60_000)
}

/**
 * Builds the Tier 2 reactivation audience for a last-minute opening.
 *
 * Rules:
 * - includes clients last seen 56+ days ago with the pro
 * - includes clients who favorited the pro
 * - then hands candidate cleanup to the shared merge/dedupe helper
 */
export async function buildTier2ReactivationAudience(args: {
  tx: LastMinuteDbClient
  opening: OpeningForTier2
  now: Date
}): Promise<Tier2ReactivationCandidate[]> {
  const { tx, opening, now } = args

  const eightWeeksAgo = daysAgo(56)

  const [lastBookings, favorites] = await Promise.all([
    tx.booking.findMany({
      where: {
        professionalId: opening.professionalId,
        scheduledFor: { lt: now },
        NOT: { status: BookingStatus.CANCELLED },
      },
      orderBy: { scheduledFor: 'desc' },
      distinct: ['clientId'],
      select: {
        clientId: true,
        scheduledFor: true,
      },
      take: 5000,
    }),
    tx.professionalFavorite.findMany({
      where: {
        professionalId: opening.professionalId,
      },
      select: {
        userId: true,
      },
      take: 5000,
    }),
  ])

  const lapsedClientIds = lastBookings
    .filter(
      (row) =>
        isNonEmptyString(row.clientId) &&
        row.scheduledFor.getTime() <= eightWeeksAgo.getTime(),
    )
    .map((row) => row.clientId)

  const favoriteUserIds = favorites
    .map((row) => row.userId)
    .filter(isNonEmptyString)

  const favoriteClientIds =
    favoriteUserIds.length > 0
      ? (
          await tx.clientProfile.findMany({
            where: {
              userId: { in: favoriteUserIds },
            },
            select: {
              id: true,
            },
            take: 5000,
          })
        )
          .map((row) => row.id)
          .filter(isNonEmptyString)
      : []

  const candidates: LastMinuteAudienceCandidate[] = Array.from(
    new Set([...lapsedClientIds, ...favoriteClientIds]),
  ).map((clientId) => ({
    clientId,
    matchedTier: LastMinuteTier.REACTIVATION,
  }))

  if (candidates.length === 0) {
    return []
  }

  return mergeAndDedupeRecipients({
    tx,
    openingId: opening.id,
    professionalId: opening.professionalId,
    openingTimeZone: opening.timeZone,
    now,
    candidates,
  })
}