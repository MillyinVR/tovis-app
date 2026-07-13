// lib/looks/relationshipSignals.ts
//
// Post-booking relationship primitive (personalization spec §6.7) behind the
// Looks feed relationship_boost term (lib/looks/personalizedRanking.ts). Unlike
// the availability primitive (a cron-refreshed per-pro aggregate), this is keyed
// on the VIEWER: which pros has this client actually BOOKED, how recently, and
// how often. It's cheap and viewer-scoped, so it's read live at serve time (once
// per feed request, like the follow set) rather than precomputed.
//
// A booking is the strongest, nearly un-fakeable signal in the hierarchy (spec
// §2), so "your pro"'s new looks should reliably surface. Only COMPLETED visits
// count — a pending/cancelled/no-show booking is not yet a relationship. The
// aggregate is deliberately COARSE (recency + visit count); the ranker grades the
// boost from those two facts (computeRelationshipBoost). The cadence-timed rebook
// PROMPTS and the "how did it go?" outcome loop of §6.7 are a separate,
// notification-budget-gated (§8.1) build — this ships only the feed prong.

import { BookingStatus, type PrismaClient } from '@prisma/client'

import type { ProRelationshipSignal } from '@/lib/looks/personalizedRanking'

// Cost bound on the completed-booking scan per viewer. A client's most recent
// completed visits are the ones that matter (recency dominates the boost); a
// power user's full multi-year history past this bound would only refine the
// loyalty count, which already saturates at relationshipFullVisits (3). Ordered
// newest-first so the truncation drops the oldest, least-relevant rows.
export const RELATIONSHIP_BOOKING_SAMPLE_SIZE = 400

/** The COMPLETED visit's effective instant: when it finished, else its slot. */
function visitInstant(row: {
  scheduledFor: Date
  finishedAt: Date | null
}): Date | null {
  const finished = row.finishedAt
  if (finished instanceof Date && !Number.isNaN(finished.getTime())) {
    return finished
  }
  const scheduled = row.scheduledFor
  if (scheduled instanceof Date && !Number.isNaN(scheduled.getTime())) {
    return scheduled
  }
  return null
}

/**
 * Fold a viewer's COMPLETED bookings into a per-pro relationship map: for each
 * professional the client has completed a visit with, the most recent visit
 * instant and the count of completed visits. Pass only COMPLETED rows (the
 * reader filters); rows with no usable timestamp are skipped. Pure + exported
 * for unit testing.
 */
export function aggregateRelationshipSignals(
  rows: ReadonlyArray<{
    professionalId: string
    scheduledFor: Date
    finishedAt: Date | null
  }>,
): Map<string, ProRelationshipSignal> {
  const map = new Map<string, ProRelationshipSignal>()

  for (const row of rows) {
    const proId =
      typeof row.professionalId === 'string' ? row.professionalId.trim() : ''
    if (!proId) continue
    const instant = visitInstant(row)
    if (!instant) continue

    const existing = map.get(proId)
    if (existing) {
      existing.completedVisits += 1
      if (instant.getTime() > existing.lastVisitAt.getTime()) {
        existing.lastVisitAt = instant
      }
    } else {
      map.set(proId, { lastVisitAt: instant, completedVisits: 1 })
    }
  }

  return map
}

/**
 * Serve-time reader: load the viewer's post-booking relationship signals, keyed
 * by professionalId. Only COMPLETED bookings count; a viewer with none gets an
 * empty map → 0 relationship boost (byte-identical to the pre-§6.7 feed). One
 * bounded query scoped to the viewer's own client id.
 */
export async function fetchClientRelationshipSignals(
  db: PrismaClient,
  clientId: string,
): Promise<Map<string, ProRelationshipSignal>> {
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    return new Map()
  }

  const rows = await db.booking.findMany({
    where: { clientId, status: BookingStatus.COMPLETED },
    orderBy: { scheduledFor: 'desc' },
    take: RELATIONSHIP_BOOKING_SAMPLE_SIZE,
    select: {
      professionalId: true,
      scheduledFor: true,
      finishedAt: true,
    },
  })

  return aggregateRelationshipSignals(rows)
}
