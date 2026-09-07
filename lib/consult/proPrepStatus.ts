// lib/consult/proPrepStatus.ts
//
// P7a-4 — what the PRO sees about a booking's prep.
//
// A separate loader from `loadAuthorizedProConsultBriefs`, deliberately. The
// Brief only exists for a COMPLETED consult (proBrief.ts filters on it, and it
// re-derives an immutable result and byte-compares it), which is exactly the
// consult that does NOT have outstanding prep. Folding prep into the Brief
// would mean the one state the pro most needs to see is the one state the
// Brief cannot carry — and it would let live prep state invalidate a finished
// Brief's byte comparison.
//
// So this reads the consult attached to a booking whatever its status, and
// answers one question: is there prep, is it done, what is missing, by when.

import 'server-only'

import { ConsultRevisionKind, Prisma } from '@prisma/client'

import { formatInTimeZone, sanitizeTimeZone, DEFAULT_TIME_ZONE } from '@/lib/time'

import { deriveConsultPrepBadge, type ConsultPrepBadge } from './prepBadge'
import {
  CONSULT_PREP_SESSION_SELECT,
  deriveConsultPrepState,
  loadConsultPrepState,
  type ConsultPrepMissingItemDTO,
} from './prepDeadline'

export type ProConsultPrepStatusDTO = {
  consultId: string
  badge: ConsultPrepBadge
  /** The outstanding questions, in the client's own words. Empty when done. */
  missing: ConsultPrepMissingItemDTO[]
  /** How many safety questions the client's pinned pack asks in total. */
  requiredCount: number
  /** ISO-8601, or null when there is no live appointment to measure from. */
  deadlineAt: string | null
  /** The deadline as a date in the appointment's own zone, for display. */
  deadlineLabel: string | null
}

/**
 * The consult attached to one booking — either anchor.
 *
 * The same two-way join `loadAuthorizedProConsultBriefs` uses (`bookingId` for
 * a booking-anchored consult, `inspiredBookings` for a spark that linked to
 * this appointment), minus its COMPLETED filter, because an unfinished consult
 * is the entire point of this read.
 */
async function findBookingConsultId(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; professionalId: string },
): Promise<string | null> {
  const session = await tx.consultSession.findFirst({
    where: {
      professionalId: args.professionalId,
      OR: [
        { bookingId: args.bookingId },
        { inspiredBookings: { some: { id: args.bookingId } } },
      ],
    },
    select: { id: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return session?.id ?? null
}

/**
 * Prep status for one of the pro's bookings, or null when there is no consult.
 *
 * Scoped by `professionalId` in the query itself rather than checked after: a
 * consult belonging to another pro must be indistinguishable from one that does
 * not exist, which is the no-leak rule every other consult read keeps.
 */
export async function loadProBookingPrepStatus(
  /**
   * A `PrismaClient` or a transaction client — both satisfy this. These are
   * READS, so callers pass `prisma` directly rather than opening a transaction
   * that buys no atomicity and costs a pooled connection.
   */
  tx: Prisma.TransactionClient,
  args: { bookingId: string; professionalId: string; now?: Date },
): Promise<ProConsultPrepStatusDTO | null> {
  const consultId = await findBookingConsultId(tx, args)
  if (!consultId) return null

  const loaded = await loadConsultPrepState(tx, consultId)
  if (!loaded) return null

  const { session, prep } = loaded
  const timeZone =
    sanitizeTimeZone(
      session.booking?.locationTimeZone ??
        session.inspiredBookings[0]?.locationTimeZone ??
        null,
    ) ?? DEFAULT_TIME_ZONE

  return {
    consultId,
    badge: deriveConsultPrepBadge(prep, args.now),
    missing: prep.missing,
    requiredCount: prep.requiredCount,
    deadlineAt: prep.deadlineAt?.toISOString() ?? null,
    deadlineLabel: prep.deadlineAt
      ? formatInTimeZone(prep.deadlineAt, timeZone, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })
      : null,
  }
}

/**
 * Prep badges for MANY bookings at once — the pro's schedule / bookings list.
 *
 * Two queries total, not two per booking. The first finds the consults linked
 * to any of these appointments; on the overwhelming majority of pros' days
 * that returns nothing and the second never runs, so a salon with no consults
 * pays one indexed lookup for the whole screen.
 *
 * Returns a map keyed by BOOKING id. A booking absent from the map has no
 * consult, which `deriveConsultPrepBadge(null)` renders as nothing.
 */
export async function loadProBookingsPrepBadges(
  tx: Prisma.TransactionClient,
  args: {
    bookingIds: readonly string[]
    professionalId: string
    now?: Date
  },
): Promise<Map<string, ConsultPrepBadge>> {
  const badges = new Map<string, ConsultPrepBadge>()
  if (args.bookingIds.length === 0) return badges

  const sessions = await tx.consultSession.findMany({
    where: {
      professionalId: args.professionalId,
      OR: [
        { bookingId: { in: [...args.bookingIds] } },
        { inspiredBookings: { some: { id: { in: [...args.bookingIds] } } } },
      ],
    },
    select: CONSULT_PREP_SESSION_SELECT,
  })
  if (sessions.length === 0) return badges

  // One read for every session's intake revisions, grouped in memory. The
  // per-session query this replaces is the same N+1 the map exists to avoid.
  const revisions = await tx.consultRevision.findMany({
    where: {
      consultSessionId: { in: sessions.map((session) => session.id) },
      kind: ConsultRevisionKind.INTAKE,
    },
    orderBy: [{ revision: 'desc' }, { id: 'desc' }],
    select: { consultSessionId: true, payload: true },
  })
  const payloadsBySession = new Map<string, unknown[]>()
  for (const revision of revisions) {
    const bucket = payloadsBySession.get(revision.consultSessionId)
    if (bucket) bucket.push(revision.payload)
    else payloadsBySession.set(revision.consultSessionId, [revision.payload])
  }

  for (const session of sessions) {
    const prep = deriveConsultPrepState({
      session,
      intakePayloads: payloadsBySession.get(session.id) ?? [],
    })
    const badge = deriveConsultPrepBadge(prep, args.now)
    // The appointment this consult is being prepared for — either anchor.
    const bookingId =
      session.bookingId ?? session.inspiredBookings[0]?.id ?? null
    if (bookingId && args.bookingIds.includes(bookingId)) {
      badges.set(bookingId, badge)
    }
  }
  return badges
}
