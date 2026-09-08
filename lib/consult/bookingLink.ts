import 'server-only'

// lib/consult/bookingLink.ts
//
// "Which booking is this consult's?" — asked once, in one place.
//
// P7a-2 put this in `thread.ts`, which was right while the thread was its only
// caller. P5g gave it a second one: an adaptive follow-up round is PREP, and
// the thread renders prep only after the booking — so the round must be BOUGHT
// only after the booking too, or a consult that never books would pay for
// questions nobody is ever shown.
//
// 🔴 Extracted rather than copied, and rather than exported from `thread.ts`.
// A copy would let the two drift over exactly the thing that is subtle here
// (the legacy fallback and its cutover). An export would make
// `followUpContract` import `thread`, which already imports `followUpContract`
// — a cycle, for one function that belongs to neither.

import { BookingStatus, type Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/**
 * Bookings that count as "she booked this look, and it is still ahead of her".
 *
 * 🔴 CANCELLED and COMPLETED are both excluded, for the same reason and it is
 * not tidiness. The booking message says "you're on Susie's calendar" and the
 * sticky CTA hides itself on `ALREADY_BOOKED` — so counting an appointment that
 * no longer exists, or one that already happened, tells her something false AND
 * takes the Book button away with no way to get it back. A consult whose
 * appointment is over is a consult she can book from again.
 */
/**
 * ⚠️ Module-private, as it was in `thread.ts` before this extraction. Nothing
 * outside needs it, and exporting it collides with the same-named list in
 * `lib/privacy/accountDeletion.ts` — which answers a DIFFERENT question (which
 * bookings block a deletion), so the two must not be consolidated into one.
 * `check:no-private-lib-fork` caught the collision the moment this was
 * exported, which is the guard doing exactly its job.
 */
const LIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
]

/**
 * The instant the explicit link went live, if it has been configured.
 *
 * Unset is the honest default: before the deploy there IS no cutover, and
 * inventing one would either blind the fallback to real legacy bookings or
 * pretend the link existed before it did. Once P7a-2 is deployed, set
 * `CONSULT_SPARK_LINK_CUTOVER_AT` to that deploy's instant (ISO-8601) and the
 * fallback narrows to exactly the pre-existing population it is for.
 *
 * A malformed value is treated as unset rather than throwing — the thread is a
 * read path, and a typo in an env var must not take the client's consult down.
 * It is logged so the typo is findable.
 */
function consultSparkLinkCutoverAt(): Date | null {
  const raw = process.env.CONSULT_SPARK_LINK_CUTOVER_AT?.trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    console.warn('CONSULT_SPARK_LINK_CUTOVER_AT is not a valid date', { raw })
    return null
  }
  return parsed
}

/**
 * Which booking is this consult's — asked of the LINK first, the old inference
 * second.
 *
 * P7a-2. The link is `Booking.sourceConsultSessionId`, stamped by the write
 * boundary after `resolveConsultSparkLink` checked that the booking's pro, look
 * and client actually match the consult. A partial unique index makes at most
 * one LIVE booking hold it, so there is nothing to disambiguate and no
 * `orderBy` that could quietly pick the wrong row.
 *
 * 🔴 The fallback exists for ONE population: bookings created before this
 * shipped, which carry no link and never will. It is P5a's inference with two
 * deliberate narrowings — its `sourceConsultSessionId` OR arm is gone (the link
 * query above owns that case now) and it matches only rows where that column is
 * NULL, so it can never take a booking that belongs to a different consult.
 *
 * It is NOT a safety net for the new path: a spark booking that failed to link
 * is a bug that must stay visible. Set `CONSULT_SPARK_LINK_CUTOVER_AT` to the
 * deploy instant once this is live and the fallback additionally stops being
 * able to see anything the link path could have handled — see
 * `consultSparkLinkCutoverAt`.
 *
 * Every fallback hit is logged so the retirement has a date rather than a
 * feeling. When this stops firing in prod, delete everything below the link
 * query. (`LIVE_BOOKING_STATUSES` stays — the link query uses it too.)
 */
/**
 * P7a-5 — the deposit columns travel with the booking id.
 *
 * The confirmation bubble has to be able to say "your $25 deposit is held and
 * comes off the total", and by that point the deposit is a STAMPED number
 * rather than a rule — which is the one place a percentage deposit can honestly
 * be shown in dollars.
 */
export const CONSULT_THREAD_BOOKING_SELECT = {
  id: true,
  depositStatus: true,
  depositAmount: true,
} satisfies Prisma.BookingSelect

export type ConsultThreadBooking = Prisma.BookingGetPayload<{
  select: typeof CONSULT_THREAD_BOOKING_SELECT
}>

export async function resolveThreadBooking(
  db: Pick<Prisma.TransactionClient, 'booking'>,
  args: {
    consultSessionId: string
    clientId: string
    professionalId: string
    anchorLookPostId: string | null
    consultCreatedAt: Date
    /** Deletion must also preserve records of past appointments. */
    includePastBookings?: boolean
  },
): Promise<ConsultThreadBooking | null> {
  const linked = await db.booking.findFirst({
    where: {
      sourceConsultSessionId: args.consultSessionId,
      ...(args.includePastBookings ? {} : { status: { in: LIVE_BOOKING_STATUSES } }),
    },
    select: CONSULT_THREAD_BOOKING_SELECT,
  })
  if (linked) return linked

  // No link. Only a LOOK-anchored consult ever had an inference to fall back
  // to; a booking-anchored one reads its appointment off its own anchor.
  if (!args.anchorLookPostId) return null

  const cutover = consultSparkLinkCutoverAt()

  const legacy = await db.booking.findFirst({
    where: {
      clientId: args.clientId,
      professionalId: args.professionalId,
      ...(args.includePastBookings ? {} : { status: { in: LIVE_BOOKING_STATUSES } }),
      sourceLookPostId: args.anchorLookPostId,
      // Unlinked only. A booking that HAS a link belongs to whichever consult
      // the boundary validated it against, and it is not this one.
      sourceConsultSessionId: null,
      // The P5a window, unchanged: at or after this consult began. Plus, when
      // the cutover is configured, strictly before the link path shipped — so
      // the fallback can never quietly cover for a spark booking that should
      // have linked and didn't.
      createdAt: cutover
        ? { gte: args.consultCreatedAt, lt: cutover }
        : { gte: args.consultCreatedAt },
    },
    select: CONSULT_THREAD_BOOKING_SELECT,
    orderBy: { createdAt: 'desc' },
  })

  if (legacy) {
    // Telemetry, not an error: this is the retirement signal for the fallback.
    console.warn('consult-thread booking resolved by LEGACY inference', {
      consultSessionId: args.consultSessionId,
      bookingId: legacy.id,
      anchorLookPostId: args.anchorLookPostId,
      cutoverConfigured: cutover !== null,
    })
  }

  return legacy
}


/**
 * The same question, asked without the caller having to load the consult first.
 *
 * P5g's generation gate: "is there a booking to hang prep off?" A consult with
 * no live booking shows no prep in the thread, so it must buy no rounds.
 */
export async function consultHasLiveBooking(
  consultSessionId: string,
): Promise<boolean> {
  const session = await prisma.consultSession.findUnique({
    where: { id: consultSessionId },
    select: {
      id: true,
      clientId: true,
      professionalId: true,
      anchorLookPostId: true,
      createdAt: true,
    },
  })
  if (!session) return false
  const booking = await resolveThreadBooking(prisma, {
    consultSessionId: session.id,
    clientId: session.clientId,
    professionalId: session.professionalId,
    anchorLookPostId: session.anchorLookPostId,
    consultCreatedAt: session.createdAt,
  })
  return booking !== null
}

/** Shared display/write eligibility. Resolve past bookings too before calling. */
export function canDeleteUnbookedConsult(
  session: Pick<Prisma.ConsultSessionGetPayload<Record<string, never>>, 'bookingId' | 'anchorLookPostId'>,
  appointment: ConsultThreadBooking | null,
): boolean {
  return !session.bookingId && !appointment && Boolean(session.anchorLookPostId)
}
