// lib/lastMinute/audience/mergeAndDedupeRecipients.ts
import { startOfDayUtcInTimeZone } from '@/lib/timeZone'
import {
  BookingStatus,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  Prisma,
} from '@prisma/client'

export type LastMinuteDbClient =
  | Prisma.TransactionClient
  | Prisma.DefaultPrismaClient

export type LastMinuteAudienceCandidate = {
  clientId: string
  matchedTier: LastMinuteTier
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function dedupeCandidatesByClientId(
  candidates: LastMinuteAudienceCandidate[],
): LastMinuteAudienceCandidate[] {
  const seen = new Set<string>()
  const deduped: LastMinuteAudienceCandidate[] = []

  for (const candidate of candidates) {
    if (!isNonEmptyString(candidate.clientId)) continue
    if (seen.has(candidate.clientId)) continue

    seen.add(candidate.clientId)
    deduped.push(candidate)
  }

  return deduped
}

async function getUpcomingClientIdsForPro(args: {
  tx: LastMinuteDbClient
  professionalId: string
  now: Date
}): Promise<Set<string>> {
  const rows = await args.tx.booking.findMany({
    where: {
      professionalId: args.professionalId,
      scheduledFor: { gte: args.now },
      NOT: { status: BookingStatus.CANCELLED },
    },
    select: {
      clientId: true,
    },
    distinct: ['clientId'],
    take: 5000,
  })

  return new Set(rows.map((row) => row.clientId).filter(isNonEmptyString))
}

async function getExistingRecipientIdsForOpening(args: {
  tx: LastMinuteDbClient
  openingId: string
}): Promise<Set<string>> {
  const rows = await args.tx.lastMinuteRecipient.findMany({
    where: {
      openingId: args.openingId,
    },
    select: {
      clientId: true,
    },
    take: 10000,
  })

  return new Set(rows.map((row) => row.clientId).filter(isNonEmptyString))
}

async function applyClientDailyLimits(args: {
  tx: LastMinuteDbClient
  clientIds: string[]
  openingTimeZone: string
  now: Date
}): Promise<Set<string>> {
  if (args.clientIds.length === 0) {
    return new Set<string>()
  }

  const settings = await args.tx.clientNotificationSettings.findMany({
    where: {
      clientId: { in: args.clientIds },
    },
    select: {
      clientId: true,
      lastMinuteEnabled: true,
      maxLastMinutePerDay: true,
    },
  })

  const settingsByClient = new Map(
    settings.map((row) => [
      row.clientId,
      {
        enabled: row.lastMinuteEnabled,
        max: row.maxLastMinutePerDay,
      },
    ]),
  )

  const todayStartUtc = startOfDayUtcInTimeZone(args.now, args.openingTimeZone)

  const sentToday = await args.tx.lastMinuteRecipient.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: args.clientIds },
      notifiedAt: { gte: todayStartUtc },
      status: {
        in: [
          LastMinuteRecipientStatus.ENQUEUED,
          LastMinuteRecipientStatus.OPENED,
          LastMinuteRecipientStatus.CLICKED,
          LastMinuteRecipientStatus.BOOKED,
        ],
      },
    },
    _count: { _all: true },
  })

  const sentTodayByClient = new Map(
    sentToday.map((row) => [row.clientId, row._count._all]),
  )

  const allowed = new Set<string>()

  for (const clientId of args.clientIds) {
    const setting = settingsByClient.get(clientId)
    if (setting?.enabled === false) {
      continue
    }

    const maxPerDay = typeof setting?.max === 'number' ? setting.max : 2
    const sentCount = sentTodayByClient.get(clientId) ?? 0

    if (sentCount < maxPerDay) {
      allowed.add(clientId)
    }
  }

  return allowed
}

/**
 * Merges and filters audience candidates for a single last-minute opening.
 *
 * What it does:
 * - preserves the first candidate seen for a given clientId
 * - removes duplicates by clientId
 * - excludes clients who already have an upcoming booking with the pro
 * - excludes clients already present in the recipient ledger for this opening
 * - excludes clients blocked by daily last-minute limits or opt-out settings
 */
export async function mergeAndDedupeRecipients(args: {
  tx: LastMinuteDbClient
  openingId: string
  professionalId: string
  openingTimeZone: string
  now: Date
  candidates: LastMinuteAudienceCandidate[]
}): Promise<LastMinuteAudienceCandidate[]> {
  const {
    tx,
    openingId,
    professionalId,
    openingTimeZone,
    now,
    candidates,
  } = args

  const deduped = dedupeCandidatesByClientId(candidates)
  if (deduped.length === 0) {
    return []
  }

  const candidateIds = deduped
    .map((candidate) => candidate.clientId)
    .filter(isNonEmptyString)

  if (candidateIds.length === 0) {
    return []
  }

  const [upcomingClientIds, existingRecipientIds, allowedByDailyLimit] =
    await Promise.all([
      getUpcomingClientIdsForPro({
        tx,
        professionalId,
        now,
      }),
      getExistingRecipientIdsForOpening({
        tx,
        openingId,
      }),
      applyClientDailyLimits({
        tx,
        clientIds: candidateIds,
        openingTimeZone,
        now,
      }),
    ])

  return deduped.filter(
    (candidate) =>
      !upcomingClientIds.has(candidate.clientId) &&
      !existingRecipientIds.has(candidate.clientId) &&
      allowedByDailyLimit.has(candidate.clientId),
  )
}