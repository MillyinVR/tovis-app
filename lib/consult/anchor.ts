// lib/consult/anchor.ts
//
// The single answer to "what is this consult anchored to, and is that anchor
// eligible right now?".
//
// Before Book the Look (B2) every consult was anchored to a booking, and seven
// call sites each re-spelled the same three identity comparisons plus
// `evaluateAiConsultBookingEligibility`. A consult can now instead be anchored
// to a LOOK with no booking (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision
// 12), so that rule had to learn a second arm — and the only safe way to teach
// seven copies the same new rule is to stop having seven copies.
//
// The booking arm is the shipped behaviour unchanged: the same identity
// comparisons, the same eligibility function, the same hidden/visible refusal
// split. Booking-anchored consults cannot change behaviour by routing here.
//
// Two strengths, because the shipped call sites used two:
//   * `evaluateConsultAnchorScope` — ownership, the founder pilot, and the
//     pilot vertical. What the agreement routes have always required (a client
//     may still record consent on a booking that has since slipped out of the
//     window; only sensitive content is refused then).
//   * `evaluateConsultAnchor` — the above plus, for a booking anchor, the
//     upcoming/90-day window. What every sensitive read and write requires.

import { Prisma } from '@prisma/client'

import { isAiConsultEnabledForPro } from './access'
import {
  AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
  AI_CONSULT_PILOT_CATEGORY_SLUGS,
  evaluateAiConsultBookingEligibility,
  type AiConsultBookingIneligibleReason,
} from './eligibility'

/**
 * Everything the anchor rule reads. Callers spread this into their own select
 * and pass the resulting row straight to the rule, so a caller cannot forget a
 * field the rule needs.
 */
export const CONSULT_ANCHOR_SELECT = {
  clientId: true,
  professionalId: true,
  serviceCategoryId: true,
  bookingId: true,
  anchorLookPostId: true,
  serviceCategory: { select: { slug: true } },
  booking: {
    select: {
      clientId: true,
      ...AI_CONSULT_ELIGIBILITY_BOOKING_SELECT,
    },
  },
} satisfies Prisma.ConsultSessionSelect

export type ConsultAnchorSession = Prisma.ConsultSessionGetPayload<{
  select: typeof CONSULT_ANCHOR_SELECT
}>

export type ConsultAnchorKind = 'BOOKING' | 'LOOK'

export type ConsultAnchorIneligibleReason =
  | AiConsultBookingIneligibleReason
  /** Neither anchor is set. A database CHECK makes this unreachable; the rule
   *  still refuses rather than assuming, because an unreachable state that
   *  silently passes is the shape of every guard that stopped guarding. */
  | 'ANCHOR_MISSING'
  /** The session's own anchor fields disagree with the anchor they point at. */
  | 'SCOPE_MISMATCH'

export type ConsultAnchorEvaluation =
  | { eligible: true; kind: ConsultAnchorKind }
  | {
      eligible: false
      reason: ConsultAnchorIneligibleReason
      /** Hidden reasons return a no-leak 404 while the pilot is dark. */
      hidden: boolean
    }

const PILOT_CATEGORY_SLUGS = new Set<string>(AI_CONSULT_PILOT_CATEGORY_SLUGS)

/**
 * Ownership, the founder gate, and the pilot vertical — no timing rule.
 *
 * `session.clientId` is the consult's owner; a booking anchor must additionally
 * belong to that same client, name the same professional, and sit in the same
 * service category as the immutable consult shell.
 */
export function evaluateConsultAnchorScope(
  session: ConsultAnchorSession,
): ConsultAnchorEvaluation {
  if (!session.bookingId && !session.anchorLookPostId) {
    return { eligible: false, reason: 'ANCHOR_MISSING', hidden: true }
  }
  if (session.bookingId) {
    if (
      !session.booking ||
      session.booking.clientId !== session.clientId ||
      session.booking.professionalId !== session.professionalId ||
      session.booking.service.categoryId !== session.serviceCategoryId
    ) {
      return { eligible: false, reason: 'SCOPE_MISMATCH', hidden: true }
    }
  }
  if (!isAiConsultEnabledForPro(session.professionalId)) {
    return { eligible: false, reason: 'FEATURE_DISABLED', hidden: true }
  }
  if (!PILOT_CATEGORY_SLUGS.has(session.serviceCategory.slug)) {
    return { eligible: false, reason: 'VERTICAL_NOT_ENABLED', hidden: true }
  }
  return { eligible: true, kind: session.bookingId ? 'BOOKING' : 'LOOK' }
}

/**
 * The scope rule plus, for a booking anchor, the upcoming/90-day window.
 *
 * A look-anchored consult has no scheduled time and no booking status, so
 * there is no window to apply. Whether the anchoring Look is still visible to
 * both participants is enforced where the Look is actually USED
 * (lib/consult/inspirationContract.ts and the database's
 * `consult_inspiration_source_valid`) rather than re-queried on every scope
 * check — the Look is this consult's inspiration source, so a Look that goes
 * away still stops the analysis.
 */
export function evaluateConsultAnchor(
  session: ConsultAnchorSession,
  now = new Date(),
): ConsultAnchorEvaluation {
  const scope = evaluateConsultAnchorScope(session)
  if (!scope.eligible || scope.kind === 'LOOK') return scope

  // Narrowed by evaluateConsultAnchorScope's booking arm above.
  if (!session.booking) {
    return { eligible: false, reason: 'SCOPE_MISMATCH', hidden: true }
  }
  const eligibility = evaluateAiConsultBookingEligibility(session.booking, now)
  return eligibility.eligible ? { eligible: true, kind: 'BOOKING' } : eligibility
}
