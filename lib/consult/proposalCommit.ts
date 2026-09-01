// lib/consult/proposalCommit.ts
//
// Book the Look, slice B4 — the COMMIT side of a booking proposal.
//
// Two things happen here, both inside the caller's locked transaction:
//
//   1. RE-DERIVE. `lib/consult/proposalEntry.ts` answered "what would I be
//      booking?" some seconds or hours ago. This asks it again, against the
//      pro's menu as it is now, because a preview is a promise about a menu
//      that can move ([[re-check-at-execution]]). The hold asks it to size the
//      slot; finalize asks it again to size the booking and to price the label
//      the client agreed to. Neither trusts a number the client sent.
//
//   2. PERSIST. The finalize path stores the answer as a ConsultBookingProposal
//      — the provenance stamp that lets B5 attach a correction pair to the
//      prices this client was actually sold, and B6 find the lines in the chair
//      ([[nothing-stored-says-who-created-a-booking]]).
//
// 🔴 The slot is sized by the ESTIMATE, not the base offering. `durationMinutes`
// below is the sum of every line, so a 3 AM booking reserves the time the whole
// look takes rather than the time its one linked service takes. That is the
// difference between an impulse booking and a lie about the pro's day
// (decision 11).

import 'server-only'

import { Prisma, type ServiceLocationType } from '@prisma/client'

import { resolveConsultCommitScope } from './commitScope'
import {
  buildConsultBookingProposal,
  CONSULT_BOOKING_PROPOSAL_DERIVATION_VERSION,
  CONSULT_BOOKING_PROPOSAL_SCHEMA_VERSION,
  type ConsultBookingProposalLineDraft,
  type ConsultBookingProposalRefusalCode,
} from './bookingProposal'
import {
  loadProposalDerivationInputs,
  toProposalEstimateInput,
} from './proposalEntry'

export type ResolvedConsultProposal = {
  consultSessionId: string
  estimateId: string
  locationType: ServiceLocationType
  stepMinutes: number
  bufferMinutes: number
  /** Sum of the line durations, excluding buffer. The width to reserve. */
  totalDurationMinutes: number
  startingAtPrice: Prisma.Decimal
  /** The look's own linked service — the offering the booking is placed against. */
  floorOfferingId: string
  lines: ConsultBookingProposalLineDraft[]
}

export type ConsultProposalCommitResult =
  | { ok: true; proposal: ResolvedConsultProposal }
  /** No such consult for this client/pro/category, or the pilot is dark. */
  | { ok: false; kind: 'HIDDEN' }
  /** The anchor is no longer eligible — a real, tellable refusal. */
  | { ok: false; kind: 'INELIGIBLE' }
  /**
   * The consult is anchored to a BOOKING, not a look — the shipped #1016 mode.
   * There is nothing to translate (the booking already carries real
   * BookingServiceItem prices), so this is NOT a refusal: the caller proceeds
   * on its ordinary path and merely attributes the consult.
   */
  | { ok: false; kind: 'NOT_LOOK_ANCHORED'; consultSessionId: string }
  /** There is a consult, but no proposal can be made. `reason` says why. */
  | {
      ok: false
      kind: 'NO_PROPOSAL'
      reason: ConsultBookingProposalRefusalCode | 'RESULT_UNAVAILABLE'
    }

/**
 * Authorize this consult for a commit by this client, then derive its proposal
 * for the mode being booked.
 *
 * The scope answer is the SAME function the booking attribution stamp uses
 * (`lib/consult/commitScope.ts`), so a proposal can never be resolved for a
 * consult the booking would then refuse to be attributed to.
 */
export async function resolveConsultProposalForCommit(
  tx: Prisma.TransactionClient,
  args: {
    consultId: string
    clientId: string
    professionalId: string
    serviceCategoryId: string | null
    locationType: ServiceLocationType
    now: Date
  },
): Promise<ConsultProposalCommitResult> {
  const scope = await resolveConsultCommitScope(tx, args)
  if (!scope.ok) {
    return { ok: false, kind: scope.hidden ? 'HIDDEN' : 'INELIGIBLE' }
  }

  // A booking-anchored consult has no estimate and never will: its booking
  // already carries real BookingServiceItem prices. Answered from the ANCHOR
  // rather than from "no estimate row found", so a look-anchored consult whose
  // estimate is somehow missing still refuses instead of quietly falling
  // through to an offering-sized slot.
  if (!scope.session.anchorLookPostId) {
    return {
      ok: false,
      kind: 'NOT_LOOK_ANCHORED',
      consultSessionId: scope.session.id,
    }
  }

  let inputs: Awaited<ReturnType<typeof loadProposalDerivationInputs>>
  try {
    inputs = await loadProposalDerivationInputs(tx, scope.session.id)
  } catch {
    // The pinned analysis could not be projected. A commit must not proceed on a
    // consult whose own analysis is unreadable — that is the state in which the
    // safety ROUTING is unknown, and unknown safety is the one thing this slice
    // may not read as "no safety prerequisites".
    return { ok: false, kind: 'NO_PROPOSAL', reason: 'RESULT_UNAVAILABLE' }
  }

  const draft = await buildConsultBookingProposal(tx, {
    professionalId: scope.session.professionalId,
    serviceCategoryId: scope.session.serviceCategoryId,
    locationType: args.locationType,
    estimate: toProposalEstimateInput(inputs.estimate),
    analysisRecommendations: inputs.analysisRecommendations,
  })

  if (draft.status === 'REFUSED') {
    return { ok: false, kind: 'NO_PROPOSAL', reason: draft.refusalCode }
  }

  const floor = draft.lines.find(
    (line) => line.source === 'LOOK_LINKED_SERVICE',
  )
  // Unreachable for a stored ESTIMATED estimate (its database trigger requires
  // exactly one floor line). Refused rather than assumed.
  if (!floor || !inputs.estimate) {
    return { ok: false, kind: 'NO_PROPOSAL', reason: 'ESTIMATE_REFUSED' }
  }

  return {
    ok: true,
    proposal: {
      consultSessionId: scope.session.id,
      estimateId: inputs.estimate.id,
      locationType: draft.locationType,
      stepMinutes: draft.stepMinutes,
      bufferMinutes: draft.bufferMinutes,
      totalDurationMinutes: draft.totalDurationMinutes,
      startingAtPrice: draft.startingAtPrice,
      floorOfferingId: floor.offeringId,
      lines: draft.lines,
    },
  }
}

/**
 * Persist the proposal the client committed to, beside its freshly-created
 * booking and inside the same transaction.
 *
 * The header's totals are written from the same draft the lines come from, and
 * the database re-checks that they equal their lines
 * ("ConsultBookingProposal_totals"): the claim that the slot is sized by the
 * estimate is worth having only if it cannot quietly stop being true.
 */
export async function persistConsultBookingProposal(
  tx: Prisma.TransactionClient,
  args: { bookingId: string; proposal: ResolvedConsultProposal },
): Promise<void> {
  await tx.consultBookingProposal.create({
    data: {
      bookingId: args.bookingId,
      consultSessionId: args.proposal.consultSessionId,
      estimateId: args.proposal.estimateId,
      locationType: args.proposal.locationType,
      stepMinutes: args.proposal.stepMinutes,
      bufferMinutes: args.proposal.bufferMinutes,
      totalDurationMinutes: args.proposal.totalDurationMinutes,
      startingAtPrice: args.proposal.startingAtPrice,
      schemaVersion: CONSULT_BOOKING_PROPOSAL_SCHEMA_VERSION,
      derivationVersion: CONSULT_BOOKING_PROPOSAL_DERIVATION_VERSION,
      lines: {
        create: args.proposal.lines.map((line) => ({
          estimateLineId: line.estimateLineId,
          sortOrder: line.sortOrder,
          serviceId: line.serviceId,
          offeringId: line.offeringId,
          serviceName: line.serviceName,
          source: line.source,
          price: line.price,
          durationMinutes: line.durationMinutes,
        })),
      },
    },
    select: { id: true },
  })
}
