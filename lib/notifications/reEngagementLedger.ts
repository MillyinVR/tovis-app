// lib/notifications/reEngagementLedger.ts
//
// Shared DB reads for the §8.1 re-engagement notification budget consumers
// (savedLookActivation, eventCountdownNotifications, rebookCadenceNotifications).
// Each consumer scans a DIFFERENT trigger source, but they all share the same
// three ledger reads against the pooled weekly budget plus the pro-availability
// lookup two of them need. Those reads were byte-identical (or differed only by
// eventKey) across the consumers, so they live here once — the pool arithmetic
// and the opt-out / dedup semantics have a single home (house rule: no duplicate
// logic).
//
// Pure policy (the cap, the priority ladder) stays in reEngagementBudget.ts; this
// module is the impure counterpart — thin, indexed reads keyed by the trigger's
// own NotificationEventKey.

import {
  BookingStatus,
  NotificationEventKey,
  type PrismaClient,
} from '@prisma/client'

import { RE_ENGAGEMENT_EVENT_KEYS } from '@/lib/notifications/reEngagementBudget'

/**
 * Pooled re-engagement send counts per client inside the budget window. Counts
 * ALL re-engagement eventKeys (the shared pool, spec §8.1), not just one trigger,
 * so a client near their cap from event countdowns also blocks a rebook nudge.
 * Cancelled dispatches don't count.
 */
export async function loadReEngagementBudgetCounts(
  db: PrismaClient,
  args: { clientIds: string[]; windowStart: Date },
): Promise<Map<string, number>> {
  if (args.clientIds.length === 0) return new Map()

  const grouped = await db.notificationDispatch.groupBy({
    by: ['clientId'],
    where: {
      clientId: { in: args.clientIds },
      eventKey: { in: [...RE_ENGAGEMENT_EVENT_KEYS] },
      createdAt: { gte: args.windowStart },
      cancelledAt: null,
    },
    _count: { _all: true },
  })

  const counts = new Map<string, number>()
  for (const group of grouped) {
    if (group.clientId) counts.set(group.clientId, group._count._all)
  }
  return counts
}

/**
 * Clients who muted the given trigger → treat as opted out (skip + count for the
 * §9 opt-out metric). Every re-engagement trigger's channels are IN_APP + EMAIL +
 * PUSH (no SMS), so all three toggled off means the recipient turned this trigger
 * off entirely.
 */
export async function loadMutedClientsForEvent(
  db: PrismaClient,
  args: { clientIds: string[]; eventKey: NotificationEventKey },
): Promise<Set<string>> {
  if (args.clientIds.length === 0) return new Set()

  const prefs = await db.clientNotificationPreference.findMany({
    where: {
      clientId: { in: args.clientIds },
      eventKey: args.eventKey,
    },
    select: {
      clientId: true,
      inAppEnabled: true,
      emailEnabled: true,
      pushEnabled: true,
    },
  })

  const muted = new Set<string>()
  for (const pref of prefs) {
    if (!pref.inAppEnabled && !pref.emailEnabled && !pref.pushEnabled) {
      muted.add(pref.clientId)
    }
  }
  return muted
}

/**
 * dedupeKeys for the given trigger that already have an inbox row → don't
 * re-nudge. Scoped to the one eventKey so a shared dedupeKey namespace across
 * triggers can never collide (each consumer's keys are prefixed, but scoping the
 * query is cheaper + unambiguous).
 */
export async function loadAlreadyNotifiedDedupeKeys(
  db: PrismaClient,
  args: { eventKey: NotificationEventKey; dedupeKeys: string[] },
): Promise<Set<string>> {
  if (args.dedupeKeys.length === 0) return new Set()

  const rows = await db.clientNotification.findMany({
    where: {
      eventKey: args.eventKey,
      dedupeKey: { in: args.dedupeKeys },
    },
    select: { dedupeKey: true },
  })

  const seen = new Set<string>()
  for (const row of rows) {
    if (row.dedupeKey) seen.add(row.dedupeKey)
  }
  return seen
}

/**
 * Booking statuses that mean a (client, pro) pair has already ENGAGED — any status
 * counts as "not a saved_not_booked pair" (they converted, tried, or have a
 * relationship). Includes terminal states on purpose: a cancelled/no-show pair still
 * has a history, so a saved-not-booked re-engagement nudge would be off-key.
 */
export const ANY_RE_ENGAGEMENT_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
]

/**
 * (client, pro) pairs that already have ANY booking → excluded from the saved-not
 * -booked re-engagement triggers (saved-look activation, hesitation consult, price
 * alternative). The `in`/`in` query over-fetches the cross product, so callers pass
 * the `wantedPairs` set (keys `${clientId}::${professionalId}`) to keep only the real
 * candidate pairs. Shared across the three consumers (house rule: no duplicate logic).
 */
export async function loadBookedReEngagementPairs(
  db: PrismaClient,
  args: {
    clientIds: string[]
    professionalIds: string[]
    wantedPairs: ReadonlySet<string>
  },
): Promise<Set<string>> {
  if (args.clientIds.length === 0 || args.professionalIds.length === 0) {
    return new Set()
  }

  const rows = await db.booking.findMany({
    where: {
      clientId: { in: args.clientIds },
      professionalId: { in: args.professionalIds },
      status: { in: ANY_RE_ENGAGEMENT_BOOKING_STATUSES },
    },
    select: { clientId: true, professionalId: true },
    distinct: ['clientId', 'professionalId'],
  })

  const booked = new Set<string>()
  for (const row of rows) {
    const key = `${row.clientId}::${row.professionalId}`
    if (args.wantedPairs.has(key)) booked.add(key)
  }
  return booked
}

/**
 * Pros with a near-term calendar opening (#604 ProfessionalAvailabilityStat
 * .nextOpeningDate within the horizon), keyed professionalId → nextOpeningDate. A
 * booked-out pro has no row and is simply absent from the map. Used by the
 * availability-gated triggers (saved-look activation, rebook cadence) to keep the
 * scan proportional to bookable-soon pros.
 */
export async function loadOpenProAvailability(
  db: PrismaClient,
  horizonEnd: Date,
): Promise<Map<string, Date>> {
  const rows = await db.professionalAvailabilityStat.findMany({
    where: { nextOpeningDate: { not: null, lte: horizonEnd } },
    select: { professionalId: true, nextOpeningDate: true },
  })

  const map = new Map<string, Date>()
  for (const row of rows) {
    if (row.nextOpeningDate) map.set(row.professionalId, row.nextOpeningDate)
  }
  return map
}
