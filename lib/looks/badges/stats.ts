// lib/looks/badges/stats.ts
//
// ProfessionalBadgeStat refresh — the hourly aggregate behind the stat-derived
// badges (spec §5.2 urgency + social proof). Three grouped queries over
// Booking, merged in code and swapped in atomically (the same replace-contents
// pattern as lib/looks/categoryRankStats.ts). Only pros with at least one
// non-zero count get a row — a missing row reads as all-zero at serve time,
// so skipping the zeros keeps the table proportional to ACTIVE pros.
//
// Window semantics (documented here because the labels must stay honest):
// - recentBookingCount: bookings CREATED in the trailing 48h, any status but
//   CANCELLED — "Booking fast" measures demand velocity, and a no-show was
//   still real demand at creation time.
// - completedBookingCount30d: COMPLETED bookings SCHEDULED in the trailing
//   30 days — social proof counts appointments that actually happened.
// - servedClientCount / rebookedClientCount: distinct clients with >=1
//   COMPLETED booking scheduled in the trailing 180 days, and the subset who
//   completed >=2 in that window. The rate is computed at read time.

import type { PrismaClient } from '@prisma/client'

import type { ProUnderbookedSignal } from '@/lib/looks/personalizedRanking'

export const PRO_BADGE_STAT_WINDOWS = {
  recentBookingHours: 48,
  completedBookingDays: 30,
  rebookWindowDays: 180,
} as const

export type ProBadgeStatCountRow = {
  professionalId: string
  count: number
}

export type ProBadgeStatRebookRow = {
  professionalId: string
  servedClientCount: number
  rebookedClientCount: number
}

export type ProfessionalBadgeStatInput = {
  professionalId: string
  recentBookingCount: number
  completedBookingCount30d: number
  servedClientCount: number
  rebookedClientCount: number
}

/**
 * Merge the three grouped rowsets into one row per pro, dropping pros whose
 * counts are all zero. Pure — unit-tested separately from the SQL.
 */
export function mergeProfessionalBadgeStatRows(args: {
  recent: readonly ProBadgeStatCountRow[]
  completed30d: readonly ProBadgeStatCountRow[]
  rebook: readonly ProBadgeStatRebookRow[]
}): ProfessionalBadgeStatInput[] {
  const byPro = new Map<string, ProfessionalBadgeStatInput>()

  const ensure = (professionalId: string): ProfessionalBadgeStatInput => {
    const existing = byPro.get(professionalId)
    if (existing) return existing
    const created: ProfessionalBadgeStatInput = {
      professionalId,
      recentBookingCount: 0,
      completedBookingCount30d: 0,
      servedClientCount: 0,
      rebookedClientCount: 0,
    }
    byPro.set(professionalId, created)
    return created
  }

  for (const row of args.recent) {
    ensure(row.professionalId).recentBookingCount = row.count
  }
  for (const row of args.completed30d) {
    ensure(row.professionalId).completedBookingCount30d = row.count
  }
  for (const row of args.rebook) {
    const entry = ensure(row.professionalId)
    entry.servedClientCount = row.servedClientCount
    entry.rebookedClientCount = row.rebookedClientCount
  }

  return Array.from(byPro.values()).filter(
    (row) =>
      row.recentBookingCount > 0 ||
      row.completedBookingCount30d > 0 ||
      row.servedClientCount > 0,
  )
}

export type RefreshProfessionalBadgeStatsResult = {
  professionals: number
  computedAt: Date
}

export async function refreshProfessionalBadgeStats(
  db: PrismaClient,
  now: Date,
): Promise<RefreshProfessionalBadgeStatsResult> {
  const recentSince = new Date(
    now.getTime() - PRO_BADGE_STAT_WINDOWS.recentBookingHours * 60 * 60 * 1000,
  )
  const completedSince = new Date(
    now.getTime() -
      PRO_BADGE_STAT_WINDOWS.completedBookingDays * 24 * 60 * 60 * 1000,
  )
  const rebookSince = new Date(
    now.getTime() -
      PRO_BADGE_STAT_WINDOWS.rebookWindowDays * 24 * 60 * 60 * 1000,
  )

  const [recent, completed30d, rebook] = await Promise.all([
    db.$queryRaw<ProBadgeStatCountRow[]>`
      SELECT b."professionalId" AS "professionalId", COUNT(*)::int AS "count"
      FROM "Booking" b
      WHERE b."createdAt" >= ${recentSince}
        AND b."status" <> 'CANCELLED'::"BookingStatus"
      GROUP BY b."professionalId"
    `,
    db.$queryRaw<ProBadgeStatCountRow[]>`
      SELECT b."professionalId" AS "professionalId", COUNT(*)::int AS "count"
      FROM "Booking" b
      WHERE b."scheduledFor" >= ${completedSince}
        AND b."status" = 'COMPLETED'::"BookingStatus"
      GROUP BY b."professionalId"
    `,
    db.$queryRaw<ProBadgeStatRebookRow[]>`
      SELECT
        per."professionalId" AS "professionalId",
        COUNT(*)::int AS "servedClientCount",
        (COUNT(*) FILTER (WHERE per."completedCount" >= 2))::int
          AS "rebookedClientCount"
      FROM (
        SELECT
          b."professionalId",
          b."clientId",
          COUNT(*)::int AS "completedCount"
        FROM "Booking" b
        WHERE b."scheduledFor" >= ${rebookSince}
          AND b."status" = 'COMPLETED'::"BookingStatus"
        GROUP BY b."professionalId", b."clientId"
      ) per
      GROUP BY per."professionalId"
    `,
  ])

  const rows = mergeProfessionalBadgeStatRows({ recent, completed30d, rebook })

  await db.$transaction([
    db.professionalBadgeStat.deleteMany({}),
    ...(rows.length > 0
      ? [
          db.professionalBadgeStat.createMany({
            data: rows.map((row) => ({ ...row, computedAt: now })),
          }),
        ]
      : []),
  ])

  return { professionals: rows.length, computedAt: now }
}

/**
 * The exact ProfessionalBadgeStat read the underbooked serve-time reader needs,
 * expressed structurally so both PrismaClient and a plain test mock satisfy it
 * without a type escape (the LookBadgeAttachDb pattern).
 */
export type ProUnderbookedReaderDb = {
  professionalBadgeStat: {
    findMany(args: {
      where: { professionalId: { in: string[] } }
      select: { professionalId: true; completedBookingCount30d: true }
    }): PromiseLike<
      Array<{ professionalId: string; completedBookingCount30d: number }>
    >
  }
}

/**
 * Serve-time reader for the §4.2/§4.5 underbooked fairness boost: the recent
 * completed-booking volume for a page's pros, keyed by professionalId. A pro
 * without a row (no non-zero counts — the refresh "skips the zeros") is simply
 * absent from the map; the ranker reads that as 0 completed bookings (maximally
 * under-discovered), NOT "no signal", so a brand-new pro still earns the on-ramp.
 * One indexed IN-list read — the same shape as fetchProAvailabilitySignals.
 */
export async function fetchProUnderbookedSignals(
  db: ProUnderbookedReaderDb,
  professionalIds: readonly string[],
): Promise<Map<string, ProUnderbookedSignal>> {
  const ids = [...new Set(professionalIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()

  const rows = await db.professionalBadgeStat.findMany({
    where: { professionalId: { in: ids } },
    select: { professionalId: true, completedBookingCount30d: true },
  })

  const map = new Map<string, ProUnderbookedSignal>()
  for (const row of rows) {
    map.set(row.professionalId, {
      completedBookingCount30d: row.completedBookingCount30d,
    })
  }
  return map
}
