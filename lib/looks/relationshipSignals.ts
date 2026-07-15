// lib/looks/relationshipSignals.ts
//
// The viewer's COMPLETED-booking signals for the Looks feed, read live at serve
// time (once per feed request, like the follow set) rather than precomputed. A
// booking is the strongest, nearly un-fakeable signal in the hierarchy (spec §2),
// so a single bounded per-viewer read feeds TWO ranking channels:
//
//  1. Per-pro relationship (§6.7) → the relationship_boost term
//     (lib/looks/personalizedRanking.ts): which pros this client has actually
//     BOOKED, how recently, and how often. Coarse (recency + visit count); the
//     ranker grades the boost from those two facts (computeRelationshipBoost).
//  2. Per-category taste (§2) → the booking→category affinity fold in
//     lib/looks/personalizedFeed.ts: which service categories the client has
//     booked, so a completed balayage visit lifts color content in the feed. The
//     category WEIGHT + slow decay live in personalizedFeed (with the other
//     affinity weights); this reader just carries the raw category slug + instant.
//
// Only COMPLETED visits count — a pending/cancelled/no-show booking is not yet a
// realized signal. The cadence-timed rebook PROMPTS and the "how did it go?"
// outcome loop of §6.7 are a separate, notification-budget-gated (§8.1) build.

import { BookingStatus, Prisma, type PrismaClient } from '@prisma/client'

import type { ProRelationshipSignal } from '@/lib/looks/personalizedRanking'

// Cost bound on the completed-booking scan per viewer, for both channels. A
// client's most recent completed visits are the ones that matter (recency
// dominates both the relationship boost and the §2 category fold); a power user's
// full multi-year history past this bound would only refine the loyalty count
// (saturates at relationshipFullVisits 3) or add already-decayed category weight.
// Ordered newest-first so the truncation drops the oldest, least-relevant rows.
export const RELATIONSHIP_BOOKING_SAMPLE_SIZE = 400

/**
 * The COMPLETED visit's effective instant: when it finished, else its slot.
 * Exported so the §2 booking→category affinity fold (personalizedFeed.ts) ages a
 * booking by the same rule the per-pro recency uses here.
 */
export function completedVisitInstant(row: {
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
    const instant = completedVisitInstant(row)
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
 * The service-portion price a client paid for a completed booking, as a plain
 * positive number: the service subtotal (serviceSubtotalSnapshot) when present,
 * else the booking subtotal (subtotalSnapshot, always set) — the same resolution
 * the client-booking DTO uses (lib/dto/clientBooking.ts). This is the closest
 * analog to a look's service `priceStartingAt`, so the §4.5 learned price band
 * (learnPriceBand, personalizedFeed.ts) compares like with like. Returns null for
 * a missing/non-finite/non-positive amount (a $0 or malformed snapshot carries no
 * price signal). Pure + exported for unit testing.
 */
export function resolveBookingServicePrice(row: {
  subtotalSnapshot: Prisma.Decimal | null
  serviceSubtotalSnapshot: Prisma.Decimal | null
}): number | null {
  const decimal = row.serviceSubtotalSnapshot ?? row.subtotalSnapshot
  if (decimal === null || decimal === undefined) return null
  const value = decimal.toNumber()
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * One COMPLETED booking, projected for the ranking channels it feeds: the
 * professional (per-pro relationship), the booked service's category slug
 * (per-category taste), and the service price paid (per-user price band).
 * `categorySlug` is null only if a booking's service is somehow uncategorized —
 * service→category is a required relation, so in practice it's always present.
 * `servicePrice` is null when the booking carries no usable price snapshot.
 */
export type CompletedBookingSignalRow = {
  professionalId: string
  scheduledFor: Date
  finishedAt: Date | null
  categorySlug: string | null
  // Service-portion price paid (spec §4.5 price band); null if unresolvable.
  servicePrice: number | null
}

export type ClientBookingSignals = {
  // Per-pro post-booking relationship map (spec §6.7 relationship_boost).
  relationshipSignals: Map<string, ProRelationshipSignal>
  // The viewer's COMPLETED visits, newest-first — the raw rows behind the §2
  // booking→category taste signal. The caller (lib/looks/personalizedFeed.ts)
  // applies the category weight + slow decay, keeping ranking constants out of
  // this reader.
  completedBookings: CompletedBookingSignalRow[]
}

/**
 * Serve-time reader: load the viewer's COMPLETED-booking signals in ONE bounded
 * query scoped to their own client id. Returns both the per-pro relationship map
 * (§6.7) and the raw completed-visit rows the §2 booking→category affinity fold
 * consumes. A viewer with no completed bookings gets an empty map + empty list →
 * 0 relationship boost and no booking-driven category weight (byte-identical to
 * the pre-booking feed).
 */
export async function fetchClientBookingSignals(
  db: PrismaClient,
  clientId: string,
): Promise<ClientBookingSignals> {
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    return { relationshipSignals: new Map(), completedBookings: [] }
  }

  const rows = await db.booking.findMany({
    where: { clientId, status: BookingStatus.COMPLETED },
    orderBy: { scheduledFor: 'desc' },
    take: RELATIONSHIP_BOOKING_SAMPLE_SIZE,
    select: {
      professionalId: true,
      scheduledFor: true,
      finishedAt: true,
      // Required service→category relation → the slug for the §2 taste fold.
      service: { select: { category: { select: { slug: true } } } },
      // Pricing snapshots → the §4.5 learned price band (service portion; the
      // required subtotal always backs the optional service subtotal).
      subtotalSnapshot: true,
      serviceSubtotalSnapshot: true,
    },
  })

  const completedBookings: CompletedBookingSignalRow[] = rows.map((row) => ({
    professionalId: row.professionalId,
    scheduledFor: row.scheduledFor,
    finishedAt: row.finishedAt,
    categorySlug: row.service?.category?.slug ?? null,
    servicePrice: resolveBookingServicePrice(row),
  }))

  return {
    relationshipSignals: aggregateRelationshipSignals(completedBookings),
    completedBookings,
  }
}
