// lib/consult/bookingProposal.ts
//
// Book the Look, slice B4 — THE BOOKING PROPOSAL.
//
// From a persisted `ConsultServiceEstimate` to something a client can commit to
// at 3 AM: a mode, a set of lines re-priced under that mode, the width those
// lines take out of the pro's day, and one client-facing "Starting at $X"
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 3, 4, 5 and 11).
//
// Four rules shape everything below.
//
// 1. AN ESTIMATE IS NOT AUTOMATICALLY A PROPOSAL. B3 derives the honest
//    PRO-FACING answer to "what does this look cost on your menu". That is not
//    the same question as "may this client commit to it unattended". When the
//    analysis routed to safety prerequisites the estimate contains the patch /
//    strand test lines AND the chemical floor — and that floor is a service the
//    analysis explicitly DECLINED to recommend yet. So the safety flags are
//    consulted before anything is proposed, and a REFUSED estimate produces a
//    refusal rather than a fallback.
//
// 2. THE MODE IS RE-DERIVED, NEVER TRANSLATED. B3 prices the SALON column,
//    because a look-anchored consult has not chosen a mode yet
//    (`CONSULT_LOOK_ESTIMATE_LOCATION_TYPE`). B4 is where the client chooses. A
//    CSV-imported pro's single price rides both modes, but a hand-configured
//    pro's mobile column can differ in price AND duration — so every line is
//    read again from the offering columns for the CHOSEN mode. A mode the pro
//    does not offer for a line is a typed refusal, never a fallback to the
//    salon number.
//
// 3. THE SLOT IS SIZED BY THE ESTIMATE, NOT THE BASE OFFERING. The width is the
//    sum of every line's rounded duration. Decision 11: a price miss is
//    corrected in the chair, a duration miss breaks the pro's day — and a 3 AM
//    booking sized by the base offering alone is a lie about that day.
//
// 4. NOTHING IS INVENTED, still. Every price and duration comes from an ACTIVE
//    offering on this pro's own menu, read now. A line whose offering has left
//    the menu refuses the proposal rather than being dropped: B3 may drop a
//    beyond-floor line because the estimate stays a true answer without it, but
//    here a dropped line silently changes the price AND the width a person is
//    being asked to commit to.
//
// This module is the DERIVATION only. It is run twice — once to preview, once
// again inside the commit transaction — because a preview is a promise about a
// menu that can move ([[re-check-at-execution]]). It never persists anything;
// the write boundary stores the commit's answer.

import 'server-only'

import {
  Prisma,
  ServiceLocationType,
  type ConsultServiceEstimateLineSource,
  type ConsultServiceEstimateRefusalCode,
} from '@prisma/client'

import { resolveBookingLocationContext } from '@/lib/booking/locationContext'
import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'

import { analysisRoutedToSafetyPrerequisites } from './safetyRouting'

import {
  loadConsultProMenuOfferings,
  type ConsultProMenuOffering,
} from './proMenu'
import { priceLine } from './serviceEstimate'

/** This contract's own version. */
export const CONSULT_BOOKING_PROPOSAL_SCHEMA_VERSION = 1

/**
 * The version of the RE-DERIVATION rules. Bump it when the safety gate, the
 * mode reconciliation, the off-menu rule or the rounding changes, so a stored
 * proposal stays interpretable against the rules that produced it.
 */
export const CONSULT_BOOKING_PROPOSAL_DERIVATION_VERSION = 'look-proposal-v1'

/**
 * Why a proposal could not be made. A plain TS union rather than a Prisma enum:
 * a refusal produces NO proposal row, so there is no column to hold it, and a
 * database type nothing stores is a type that drifts unnoticed.
 */
export type ConsultBookingProposalRefusalCode =
  /** No estimate at all — a booking-anchored consult, or one not yet analyzed. */
  | 'ESTIMATE_MISSING'
  /** B3 already named which of the pro's fields was missing. Don't paper over it. */
  | 'ESTIMATE_REFUSED'
  /** 🔴 The analysis routed to safety prerequisites. Rule 1 above. */
  | 'SAFETY_REVIEW_REQUIRED'
  /** A line's offering is no longer active on the pro's menu. */
  | 'OFFERING_OFF_MENU'
  /** The pro does not offer one of the lines in the chosen mode. */
  | 'MODE_NOT_OFFERED'
  /** Offered in the chosen mode, but she has set no price for it. */
  | 'MODE_PRICE_UNSET'
  /** Offered in the chosen mode, but she has set no duration for it. */
  | 'MODE_DURATION_UNSET'
  /** No bookable location for the chosen mode, so no slot to size. */
  | 'PRO_SCHEDULING_NOT_READY'
  /** The lines sum past the longest appointment the calendar can hold. */
  | 'SLOT_TOO_LONG'

export type ConsultBookingProposalLineDraft = {
  sortOrder: number
  /** The estimate line this was re-derived from — keeps the chain walkable. */
  estimateLineId: string
  serviceId: string
  offeringId: string
  serviceName: string
  source: ConsultServiceEstimateLineSource
  price: Prisma.Decimal
  durationMinutes: number
}

export type ConsultBookingProposalDraft =
  | {
      status: 'PROPOSED'
      refusalCode: null
      locationType: ServiceLocationType
      stepMinutes: number
      bufferMinutes: number
      /** Sum of the line durations. Excludes the buffer, like every other
       *  booking width in this codebase — the buffer is applied separately by
       *  the conflict engine from `bufferMinutes`. */
      totalDurationMinutes: number
      /** Sum of the line prices — the client-facing "Starting at" figure. */
      startingAtPrice: Prisma.Decimal
      lines: ConsultBookingProposalLineDraft[]
    }
  | {
      status: 'REFUSED'
      refusalCode: ConsultBookingProposalRefusalCode
      locationType: ServiceLocationType
      lines: []
    }

/**
 * The estimate material the derivation reads. Deliberately NOT the estimate's
 * own prices or durations: those are the SALON reading, and reusing them for a
 * mobile booking is the exact bug rule 2 exists to prevent.
 */
export type ConsultBookingProposalEstimateInput = {
  status: 'ESTIMATED' | 'REFUSED'
  lines: ReadonlyArray<{
    id: string
    sortOrder: number
    serviceId: string
    offeringId: string
    source: ConsultServiceEstimateLineSource
  }>
}

/**
 * The analysis material the safety gate reads — nothing else from the payload.
 *
 * 🔴 The RECOMMENDATIONS, not `safetyFlags`. Every hair-color analysis carries a
 * safety flag: `addRequiredSafetyFlags` adds ALLERGY_HISTORY_UNKNOWN
 * unconditionally because the intake never asks about allergies. Gating on
 * "any safety flag" would refuse every proposal ever made and look, from the
 * outside, exactly like a feature that does not work. The real routing signal
 * is `analysisRoutedToSafetyPrerequisites` — see its comment.
 */
export type ConsultBookingProposalSafetyInput = ReadonlyArray<{
  serviceIntent: string
}>

function refused(
  refusalCode: ConsultBookingProposalRefusalCode,
  locationType: ServiceLocationType,
): ConsultBookingProposalDraft {
  return { status: 'REFUSED', refusalCode, locationType, lines: [] }
}

/**
 * B3's refusal vocabulary is about the pro's MENU in the abstract; B4's is about
 * the mode the client just chose. Same underlying fields, different question, so
 * the codes are mapped rather than shared — "MENU_PRICE_UNSET" on a proposal
 * would not tell the client which mode to try instead.
 */
function toProposalRefusal(
  code: ConsultServiceEstimateRefusalCode,
): ConsultBookingProposalRefusalCode {
  switch (code) {
    case 'MENU_MODE_UNAVAILABLE':
      return 'MODE_NOT_OFFERED'
    case 'MENU_PRICE_UNSET':
      return 'MODE_PRICE_UNSET'
    case 'MENU_DURATION_UNSET':
      return 'MODE_DURATION_UNSET'
    case 'PRO_SCHEDULING_NOT_READY':
      return 'PRO_SCHEDULING_NOT_READY'
    // The estimate's own look-linkage refusals cannot be reached from here: a
    // stored ESTIMATED estimate already resolved its floor. They map to the
    // honest "that estimate is not proposable" rather than to a mode reason.
    case 'LOOK_SERVICE_UNLINKED':
    case 'SERVICE_NOT_ON_MENU':
      return 'OFFERING_OFF_MENU'
  }
}

/**
 * The derivation itself, with every input already resolved. Pure and total: it
 * either returns priced lines or names the reason it could not.
 */
export function deriveConsultBookingProposal(args: {
  locationType: ServiceLocationType
  stepMinutes: number
  bufferMinutes: number
  menu: readonly ConsultProMenuOffering[]
  estimate: ConsultBookingProposalEstimateInput | null
  /** The stored analysis's own recommendations. See the type's comment. */
  analysisRecommendations: ConsultBookingProposalSafetyInput
}): ConsultBookingProposalDraft {
  const { locationType } = args

  if (!args.estimate) return refused('ESTIMATE_MISSING', locationType)
  if (args.estimate.status === 'REFUSED') {
    return refused('ESTIMATE_REFUSED', locationType)
  }

  // 🔴 Rule 1. The estimate for a safety-routed analysis is a real, honest
  // pro-facing answer — the test lines AND the chemical floor — and it is
  // precisely NOT a thing to hand a client as a bookable price at 3 AM, because
  // that floor is a service the analysis explicitly declined to recommend yet.
  //
  // The signal is the analysis's own SERVICE INTENT, resolved through
  // `analysisRoutedToSafetyPrerequisites` — never a line's NAME (a renamed
  // service would walk straight past that) and never `safetyFlags` (always
  // non-empty; see the input type's comment).
  if (analysisRoutedToSafetyPrerequisites(args.analysisRecommendations)) {
    return refused('SAFETY_REVIEW_REQUIRED', locationType)
  }

  if (args.estimate.lines.length === 0) {
    // An ESTIMATED estimate always carries its floor (B3's DB trigger says so).
    // Refusing rather than proposing an empty booking keeps that unreachable
    // state from silently becoming a zero-line commitment.
    return refused('ESTIMATE_REFUSED', locationType)
  }

  const byOfferingId = new Map(
    args.menu.map((offering) => [offering.id, offering]),
  )

  const lines: ConsultBookingProposalLineDraft[] = []
  let totalDurationMinutes = 0
  let startingAtPrice = new Prisma.Decimal(0)

  const ordered = [...args.estimate.lines].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )

  for (const [index, estimateLine] of ordered.entries()) {
    // Read the offering by its OWN id, not by service: the estimate stored
    // which menu row it priced, and a pro who replaced that row has changed the
    // thing the client is being quoted.
    const offering = byOfferingId.get(estimateLine.offeringId)
    if (!offering || offering.serviceId !== estimateLine.serviceId) {
      return refused('OFFERING_OFF_MENU', locationType)
    }

    const priced = priceLine(offering, locationType, args.stepMinutes)
    if (!priced.ok) {
      return refused(toProposalRefusal(priced.refusalCode), locationType)
    }

    lines.push({
      sortOrder: index,
      estimateLineId: estimateLine.id,
      serviceId: estimateLine.serviceId,
      offeringId: offering.id,
      // Re-snapshotted from the menu NOW: the pro may have renamed the service
      // since the estimate, and the client must be shown today's name.
      serviceName: offering.service.name,
      source: estimateLine.source,
      price: priced.price,
      durationMinutes: priced.durationMinutes,
    })

    totalDurationMinutes += priced.durationMinutes
    startingAtPrice = startingAtPrice.add(priced.price)
  }

  // Refused, never CLAMPED. Finalize clamps a base+add-ons width to this
  // ceiling, which is right for a selection a client can shrink; a proposal has
  // no such knob, and a silently shortened slot is exactly the duration miss
  // decision 11 protects against.
  if (totalDurationMinutes > MAX_SLOT_DURATION_MINUTES) {
    return refused('SLOT_TOO_LONG', locationType)
  }

  return {
    status: 'PROPOSED',
    refusalCode: null,
    locationType,
    stepMinutes: args.stepMinutes,
    bufferMinutes: args.bufferMinutes,
    totalDurationMinutes,
    startingAtPrice,
    lines,
  }
}

/**
 * Resolve every input from the database, then derive.
 *
 * Takes a `tx` so the commit path can run it inside the finalize transaction —
 * the width it returns is the width that transaction will reserve, read from
 * the same snapshot of the pro's menu.
 */
export async function buildConsultBookingProposal(
  tx: Prisma.TransactionClient,
  args: {
    professionalId: string
    serviceCategoryId: string
    locationType: ServiceLocationType
    estimate: ConsultBookingProposalEstimateInput | null
    analysisRecommendations: ConsultBookingProposalSafetyInput
  },
): Promise<ConsultBookingProposalDraft> {
  // Slot granularity and buffer come from the pro's bookable location for the
  // CHOSEN mode — a pro can have a salon location and no mobile one, and that
  // is a real "she doesn't do this at your place" answer rather than an error.
  // The timezone is irrelevant to a minute count, so it is not required.
  const locationContext = await resolveBookingLocationContext({
    tx,
    professionalId: args.professionalId,
    locationType: args.locationType,
    requireValidTimeZone: false,
    fallbackTimeZone: 'UTC',
  })
  if (!locationContext.ok) {
    return refused('PRO_SCHEDULING_NOT_READY', args.locationType)
  }

  const menu = await loadConsultProMenuOfferings(tx, {
    professionalId: args.professionalId,
    serviceCategoryId: args.serviceCategoryId,
  })

  return deriveConsultBookingProposal({
    locationType: args.locationType,
    stepMinutes: locationContext.context.stepMinutes,
    bufferMinutes: locationContext.context.bufferMinutes,
    menu,
    estimate: args.estimate,
    analysisRecommendations: args.analysisRecommendations,
  })
}
