// lib/clientVisibility.ts
import { prisma } from '@/lib/prisma'
import { BookingStatus, Prisma } from '@prisma/client'

export type ClientVisibilityReason =
  | 'ACTIVE_BOOKING'
  | 'PENDING_BOOKING'
  | 'UPCOMING_ACCEPTED'
  | 'RECENT_COMPLETED'
  | 'NONE'

export type ClientVisibilityResult = {
  canViewClient: boolean
  reason: ClientVisibilityReason
  /**
   * When access is time-bounded (RECENT_COMPLETED), the moment it closes — for
   * the UI to render a countdown. Open-ended access (active/pending/upcoming)
   * returns null.
   */
  accessUntil: Date | null
}

/**
 * After a visit COMPLETES, the pro keeps full chart access for this many days,
 * then a hard cutoff. Rebooking re-opens access automatically (a new
 * pending/upcoming booking matches the earlier clauses). Single source of truth
 * for the window — do NOT inline a second copy anywhere.
 */
export const RECENT_COMPLETED_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Start of the recent-completed window: now − RECENT_COMPLETED_WINDOW_DAYS. */
function recentCompletedCutoff(now: Date): Date {
  return new Date(now.getTime() - RECENT_COMPLETED_WINDOW_DAYS * DAY_MS)
}

/**
 * THE single visibility rule. A pro can view/edit a client's chart when they
 * have, for that client, a booking that is:
 *  - currently in progress (startedAt set, not yet finished), OR
 *  - PENDING, OR
 *  - ACCEPTED and still upcoming, OR
 *  - COMPLETED within the last RECENT_COMPLETED_WINDOW_DAYS days
 *    (COALESCE(finishedAt, scheduledFor) >= cutoff). CANCELLED / no-show never
 *    count.
 *
 * The clients list, the clickable name, and the page gate ALL consume this so
 * they can never disagree. If you need this logic again, import it — never
 * re-inline the clauses (grep guard in clientVisibility.test.ts).
 */
export function proClientVisibilityWhere(now: Date): Prisma.BookingWhereInput {
  const cutoff = recentCompletedCutoff(now)

  return {
    OR: [
      // In progress.
      { startedAt: { not: null }, finishedAt: null },
      // Pending.
      { status: BookingStatus.PENDING },
      // Accepted + upcoming.
      { status: BookingStatus.ACCEPTED, scheduledFor: { gte: now } },
      // Completed within the post-visit window. COALESCE(finishedAt,
      // scheduledFor) >= cutoff, expressed as a fallback OR.
      {
        status: BookingStatus.COMPLETED,
        OR: [
          { finishedAt: { gte: cutoff } },
          { finishedAt: null, scheduledFor: { gte: cutoff } },
        ],
      },
    ],
  }
}

type VisibilityRow = {
  status: BookingStatus
  startedAt: Date | null
  finishedAt: Date | null
  scheduledFor: Date
}

// Lower rank = higher priority. ACTIVE > PENDING > UPCOMING_ACCEPTED > RECENT_COMPLETED.
const REASON_RANK: Record<Exclude<ClientVisibilityReason, 'NONE'>, number> = {
  ACTIVE_BOOKING: 0,
  PENDING_BOOKING: 1,
  UPCOMING_ACCEPTED: 2,
  RECENT_COMPLETED: 3,
}

/**
 * Classify a single matching booking row into the reason it grants access,
 * plus the access-close moment (only meaningful for RECENT_COMPLETED).
 * Mirrors the clauses in proClientVisibilityWhere — every row returned by that
 * filter classifies into exactly one non-NONE reason.
 */
function classifyRow(
  row: VisibilityRow,
  now: Date,
): { reason: Exclude<ClientVisibilityReason, 'NONE'>; accessUntil: Date | null } {
  if (row.startedAt && !row.finishedAt) {
    return { reason: 'ACTIVE_BOOKING', accessUntil: null }
  }
  if (row.status === BookingStatus.PENDING) {
    return { reason: 'PENDING_BOOKING', accessUntil: null }
  }
  if (row.status === BookingStatus.ACCEPTED && row.scheduledFor >= now) {
    return { reason: 'UPCOMING_ACCEPTED', accessUntil: null }
  }
  // Remaining matched case: COMPLETED within the window.
  const basis = row.finishedAt ?? row.scheduledFor
  return {
    reason: 'RECENT_COMPLETED',
    accessUntil: new Date(basis.getTime() + RECENT_COMPLETED_WINDOW_DAYS * DAY_MS),
  }
}

/**
 * Policy: see proClientVisibilityWhere. Priority is deterministic:
 * ACTIVE > PENDING > UPCOMING_ACCEPTED > RECENT_COMPLETED.
 *
 * Single query: fetch the matching bookings and reduce to the highest-priority
 * reason in JS (so priority is deterministic regardless of row order). For a
 * RECENT_COMPLETED winner, accessUntil is the latest (most generous) cutoff.
 */
export async function getProClientVisibility(
  proId: string,
  clientId: string,
): Promise<ClientVisibilityResult> {
  const now = new Date()

  const rows = await prisma.booking.findMany({
    where: {
      clientId,
      professionalId: proId,
      ...proClientVisibilityWhere(now),
    },
    select: {
      status: true,
      startedAt: true,
      finishedAt: true,
      scheduledFor: true,
    },
    take: 100,
  })

  if (rows.length === 0) {
    return { canViewClient: false, reason: 'NONE', accessUntil: null }
  }

  let bestRank = Number.POSITIVE_INFINITY
  let bestReason: ClientVisibilityReason = 'NONE'
  let accessUntil: Date | null = null

  for (const row of rows) {
    const c = classifyRow(row, now)
    const rank = REASON_RANK[c.reason]
    if (rank < bestRank) {
      bestRank = rank
      bestReason = c.reason
      accessUntil = c.accessUntil
    } else if (rank === bestRank && c.accessUntil && (!accessUntil || c.accessUntil > accessUntil)) {
      // Same tier (RECENT_COMPLETED): keep the most generous cutoff.
      accessUntil = c.accessUntil
    }
  }

  return { canViewClient: true, reason: bestReason, accessUntil }
}

/**
 * For list pages: visible client ids for this pro.
 * Same policy as getProClientVisibility, just batched.
 */
export async function getVisibleClientIdSetForPro(proId: string): Promise<Set<string>> {
  const now = new Date()

  const rows = await prisma.booking.findMany({
    where: {
      professionalId: proId,
      ...proClientVisibilityWhere(now),
    },
    select: { clientId: true },
    distinct: ['clientId'],
    take: 5000,
  })

  return new Set(rows.map((r) => r.clientId))
}

/**
 * Use this in server pages/routes to hard-gate access.
 * Returns a result so the page can choose redirect vs notFound.
 */
export async function assertProCanViewClient(proId: string, clientId: string) {
  const visibility = await getProClientVisibility(proId, clientId)
  return visibility.canViewClient ? { ok: true as const, visibility } : { ok: false as const, visibility }
}
