import { effectiveConsultLookPlan } from './lookBriefPlan'
import { readStoredLookAdjustments } from './lookAdjustments'
// lib/consult/proposalEntry.ts
//
// Book the Look, slice B4 — the client-facing entry to a booking proposal:
// "for this consult, in this mode, what would I be booking and what does it
// start at?".
//
// The AUTHORIZATION here is deliberately the same rule the client's own results
// page runs (lib/consult/clientResults.ts): her consult, founder-gated,
// COMPLETED, anchor still eligible, agreements still current. A proposal shows
// prices derived from her analysis, so it must not be reachable one gate
// looser than the analysis itself.
//
// The REFUSALS are modelled on B2's look-availability endpoint: a reason that
// leaks nothing is named, and everything else is a silent `available: false`.
// The founder gate is the silent one — while the pilot is dark for a pro, her
// consults answer exactly like a client who has none.

import 'server-only'
import { isConsultRequiredEstimateSource } from './serviceEstimate'

import {
  BookingStatus,
  Prisma,
  ConsultSessionStatus,
  ServiceLocationType,
} from '@prisma/client'

import type {
  ConsultBookingProposalAvailabilityDTO,
  ConsultBookingProposalDTO,
  ConsultBookingProposalRecommendationDTO,
} from '@/lib/dto/consult'
import {
  formatEnhancementDurationDelta,
  formatEnhancementPriceDelta,
} from './enhancementOffer'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { COPY } from '@/lib/copy'
import { formatConsultProposalStartingPrice } from '@/lib/looks/startingPrice'
import { moneyToFixed2String } from '@/lib/money'
import { prisma } from '@/lib/prisma'

import { isAiConsultC7ExposureEnabledForPro } from './access'
import { requireCurrentConsultAgreementAcceptances } from './agreementContract'
import { CONSULT_ANCHOR_SELECT, evaluateConsultAnchor, evaluateConsultAnchorScope } from './anchor'
import {
  buildConsultBookingProposal,
  type ConsultBookingProposalAnalysisInput,
  type ConsultBookingProposalDraft,
  type ConsultBookingProposalEnhancementSelection,
  type ConsultBookingProposalEstimateInput,
} from './bookingProposal'
import { normalizeStoredConsultAnalysisPayload } from './analysisRevision'

export type ConsultProposalEntryErrorCode = 'HIDDEN' | 'NOT_FOUND' | 'UNAVAILABLE'

export class ConsultProposalEntryError extends Error {
  constructor(readonly code: ConsultProposalEntryErrorCode) {
    super('Consult booking proposal unavailable.')
    this.name = 'ConsultProposalEntryError'
  }
}

const PROPOSAL_SCOPE_SELECT = {
  id: true,
  status: true,
  client: { select: { userId: true } },
  // Decision 4's client-facing half: whether committing books instantly or
  // sends a request that already holds the slot.
  professional: { select: { autoAcceptBookings: true } },
  ...CONSULT_ANCHOR_SELECT,
} satisfies Prisma.ConsultSessionSelect

export type ConsultProposalScope = Prisma.ConsultSessionGetPayload<{
  select: typeof PROPOSAL_SCOPE_SELECT
}>

/**
 * The estimate as the proposal derivation wants it: identity and ordering only.
 * Its PRICES are deliberately not selected — they are the salon reading, and
 * the whole point of B4's mode reconciliation is that they are re-derived.
 */
const PROPOSAL_ESTIMATE_SELECT = {
  id: true,
  status: true,
  sourceLookBriefVersion: { select: { selectedLocationType: true, selectedPathIndex: true, adjustments: true, professionalPlan: true } },
  // The ANALYSIS revision this estimate was derived from. The safety gate reads
  // its recommendations — the exact payload B3 translated, not a later one.
  sourceAnalysisRevision: { select: { payload: true, schemaVersion: true } },
  lines: {
    select: {
      id: true,
      sortOrder: true,
      serviceId: true,
      offeringId: true,
      source: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ConsultServiceEstimateSelect

export type ConsultProposalEstimateRow =
  Prisma.ConsultServiceEstimateGetPayload<{
    select: typeof PROPOSAL_ESTIMATE_SELECT
  }>

/**
 * Ownership, the founder gate, COMPLETED, anchor eligibility and live
 * agreements — the results page's rule, unchanged.
 *
 * Takes the session lock first for the same reason `clientResults` does:
 * lifecycle and revocation writers use it, so the scope is read from a coherent
 * state rather than from a snapshot taken mid-revocation.
 */
export async function requireAuthorizedProposalScope(
  tx: Prisma.TransactionClient,
  args: {
    consultSessionId: string
    clientId: string
    actorUserId: string
    readOnly?: boolean
    now?: Date
  },
): Promise<ConsultProposalScope> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "ConsultSession"
    WHERE "id" = ${args.consultSessionId}
    FOR UPDATE
  `)
  if (locked.length === 0) throw new ConsultProposalEntryError('NOT_FOUND')

  const session = await tx.consultSession.findUnique({
    where: { id: args.consultSessionId },
    select: PROPOSAL_SCOPE_SELECT,
  })
  if (
    !session ||
    session.clientId !== args.clientId ||
    session.client.userId !== args.actorUserId
  ) {
    throw new ConsultProposalEntryError('NOT_FOUND')
  }
  if (!isAiConsultC7ExposureEnabledForPro(session.professionalId)) {
    throw new ConsultProposalEntryError('HIDDEN')
  }
  if (session.status !== ConsultSessionStatus.COMPLETED) {
    throw new ConsultProposalEntryError('UNAVAILABLE')
  }
  const anchor = args.readOnly ? evaluateConsultAnchorScope(session) : evaluateConsultAnchor(session, args.now ?? new Date())
  if (!anchor.eligible) {
    throw new ConsultProposalEntryError(anchor.hidden ? 'HIDDEN' : 'UNAVAILABLE')
  }
  try {
    await requireCurrentConsultAgreementAcceptances(tx, session.id)
  } catch {
    throw new ConsultProposalEntryError('UNAVAILABLE')
  }
  return session
}

/**
 * The estimate, and the recommendations of the ANALYSIS it was derived from.
 *
 * 🔴 The safety gate reads the analysis's own recommendations — their
 * `serviceIntent` — and not the estimate's lines. B3's lines record what was
 * PRICED, never why the analysis routed there, so a proposal that tried to
 * recognise a safety prerequisite by a line's NAME would be one renamed service
 * away from booking a chemical treatment the analysis declined to recommend.
 *
 * B7 reads the SAME array for a second purpose: an enhancement's client-facing
 * reason is that recommendation's own `rationale`, matched by its resolved
 * SERVICE reference — never composed from a service name, for the reason
 * decision 1 gives.
 *
 * It reads the revision the estimate PINNED rather than the latest one, because
 * that pin is what makes the estimate interpretable at all: the lines and the
 * safety answer must come from the same analysis.
 */
export async function loadProposalDerivationInputs(
  tx: Prisma.TransactionClient,
  consultSessionId: string,
): Promise<{
  estimate: ConsultProposalEstimateRow | null
  analysisRecommendations: ConsultBookingProposalAnalysisInput
  /**
   * 🔴 Read from the PLAN, not from the recommendation intents.
   * `analysisRoutedToSafetyPrerequisites` answers false for every Book the
   * Look consult — `resolveRecommendations` collapses a safety-routed
   * look-planning analysis to one CONSULTATION and returns early, so the
   * PATCH_TEST / STRAND_TEST intents it looks for are never stored. The plan
   * carries the fact itself; see `ConsultLookPlanDTO.safetyRouted`.
   */
  lookPlanSafetyRouted: boolean
}> {
  // P7a-3: the LATEST estimate, not "the" estimate. A consult now holds one per
  // analysis version, because a rerun reprices — so the proposal must be built
  // from the newest plan the client has actually been shown, and `findUnique`
  // on `consultSessionId` has stopped being a question with one answer.
  const latestAnalysis = await tx.consultRevision.findFirst({
    where: { consultSessionId, kind: 'ANALYSIS' }, orderBy: { revision: 'desc' },
    select: { id: true, payload: true, schemaVersion: true },
  })
  let sourceLookBriefVersionId: string | undefined
  let lookPlanSafetyRouted = false
  if (latestAnalysis) {
    const plan = normalizeStoredConsultAnalysisPayload(latestAnalysis.payload, latestAnalysis.schemaVersion).lookPlan
    if (plan) {
      const version = await tx.consultLookBriefVersion.findFirst({
        where: { consultSessionId }, orderBy: { version: 'desc' },
        select: { id: true, sourceAnalysisRevisionId: true, selectedPathIndex: true, awaitingAnalysis: true, professionalPlan: true, invalidatedProfessionalPlan: true },
      })
      const currentPlan = effectiveConsultLookPlan(normalizeStoredConsultAnalysisPayload(latestAnalysis.payload, latestAnalysis.schemaVersion), version)
      if (!currentPlan || !currentPlan.choosable || !version ||
        version.awaitingAnalysis || version.sourceAnalysisRevisionId !== latestAnalysis.id || version.selectedPathIndex === null) {
        return { estimate: null, analysisRecommendations: [], lookPlanSafetyRouted: false }
      }
      sourceLookBriefVersionId = version.id
      lookPlanSafetyRouted = currentPlan.safetyRouted
    }
  }
  const estimate = await tx.consultServiceEstimate.findFirst({
    where: { consultSessionId, ...(latestAnalysis ? { sourceAnalysisRevisionId: latestAnalysis.id } : {}),
      ...(sourceLookBriefVersionId ? { sourceLookBriefVersionId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: PROPOSAL_ESTIMATE_SELECT,
  })

  if (!estimate) return { estimate: null, analysisRecommendations: [], lookPlanSafetyRouted }

  let analysisRecommendations: ConsultBookingProposalAnalysisInput
  try {
    analysisRecommendations = normalizeStoredConsultAnalysisPayload(
      estimate.sourceAnalysisRevision.payload,
      estimate.sourceAnalysisRevision.schemaVersion,
    ).recommendations
  } catch {
    // The pinned analysis will not project. Refuse rather than proceed: this is
    // the state in which the safety routing is UNKNOWN, and unknown safety is
    // the one thing this slice may not read as "no safety prerequisites".
    throw new ConsultProposalEntryError('UNAVAILABLE')
  }

  // A pro-authored plan drops the AI's recommendations, but NOT the safety
  // fact: the pro redrawing the look does not clear a patch test the intake
  // called for (`professionalLookPlan` inherits it onto their plan).
  return { estimate, lookPlanSafetyRouted,
    analysisRecommendations: estimate.sourceLookBriefVersion?.professionalPlan ? [] : analysisRecommendations }
}

export function toProposalEstimateInput(
  row: ConsultProposalEstimateRow | null,
): ConsultBookingProposalEstimateInput | null {
  if (!row) return null
  return {
    status: row.status,
    ...(row.sourceLookBriefVersion?.selectedPathIndex !== null && row.sourceLookBriefVersion?.selectedPathIndex !== undefined ? {
      selectedLook: { pathIndex: row.sourceLookBriefVersion.selectedPathIndex,
        adjustments: readStoredLookAdjustments(row.sourceLookBriefVersion.adjustments) },
    } : {}),
    lines: row.lines.map((line) => ({
      id: line.id,
      sortOrder: line.sortOrder,
      serviceId: line.serviceId,
      offeringId: line.offeringId,
      source: line.source,
    })),
  }
}

/**
 * The DTO for a derived proposal.
 *
 * `offeringId` is the FLOOR line's offering — the look's own linked service.
 * That is the offering a hold and a finalize are placed against: the booking's
 * base service item is the look itself, while the lines size the slot and the
 * starting price.
 *
 * B7: the beyond-floor lines are now the client's to take or leave. `lines` is
 * the floor plus what she opted into — so `startingAtPrice` and
 * `totalDurationMinutes` are what she is actually committing to — and
 * `recommendations` is the whole offer, selected or not.
 */
export function toConsultBookingProposalDTO(args: {
  consultId: string
  professionalId: string
  /** The consult's look anchor. Null on a booking-anchored consult. */
  lookPostId: string | null
  draft: Extract<ConsultBookingProposalDraft, { status: 'PROPOSED' }>
  /** The pro's `autoAcceptBookings` toggle, read fresh. */
  autoAcceptBookings: boolean
}): ConsultBookingProposalDTO | null {
  const floor = args.draft.lines.find(
    (line) => isConsultRequiredEstimateSource(line.source),
  )
  // Unreachable for a stored ESTIMATED estimate (the database trigger requires
  // exactly one floor line), and refused rather than assumed: a proposal with
  // no offering to book against is not a proposal.
  if (!floor) return null

  // A proposal only ever exists for a LOOK-anchored consult (a booking-anchored
  // one has no estimate to derive from), so the anchor is expected here. Refused
  // rather than defaulted: the look id is the discovery reference the booking is
  // attributed to, and inventing one is how attribution silently goes wrong.
  if (!args.lookPostId) return null

  return {
    consultId: args.consultId,
    locationType: args.draft.locationType,
    offeringId: floor.offeringId,
    professionalId: args.professionalId,
    serviceId: floor.serviceId,
    lookPostId: args.lookPostId,
    totalDurationMinutes: args.draft.totalDurationMinutes,
    // Decimal string, not a JSON number: money never round-trips through a float.
    startingAtPrice: moneyToFixed2String(args.draft.startingAtPrice) ?? '0.00',
    startingAtLabel: formatConsultProposalStartingPrice(
      args.draft.startingAtPrice,
    ),
    estimateNote: COPY.consultProposal.estimateNote,
    // The disclosure that replaced the refusal. Non-null exactly when the
    // pinned analysis routed to a patch or strand test.
    safetyNote: args.draft.safetyRouted ? COPY.consultProposal.safetyTestFirst : null,
    proDecidesNote: COPY.consultProposal.proDecides,
    autoAccepts: args.autoAcceptBookings,
    // Routed through the SAME fork the commit runs (decision 4) rather than
    // branching on the toggle again here. A second reading of "does this book
    // instantly?" is how a preview ends up promising something the booking then
    // does not do.
    commitNote:
      getClientSubmittedBookingStatus(args.autoAcceptBookings) ===
      BookingStatus.ACCEPTED
        ? COPY.consultProposal.commitInstant
        : COPY.consultProposal.commitRequest,
    lines: args.draft.lines.map((line) => ({
      serviceName: line.serviceName,
      price: moneyToFixed2String(line.price) ?? '0.00',
      durationMinutes: line.durationMinutes,
    })),
    recommendations: args.draft.recommendations.map(
      (recommendation): ConsultBookingProposalRecommendationDTO => ({
        estimateLineId: recommendation.estimateLineId,
        // The analysis's own sentence. No service name is carried onto this
        // wire at all — see the DTO's comment.
        outcome: recommendation.outcome,
        priceDeltaLabel: formatEnhancementPriceDelta(recommendation.price),
        durationDeltaLabel: formatEnhancementDurationDelta(
          recommendation.durationMinutes,
        ),
        selected: recommendation.selected,
      }),
    ),
  }
}

/**
 * Authorize, resolve, derive — the preview.
 *
 * 🔴 This answer is a PREVIEW, never an offer. It is re-derived inside the
 * commit transaction from the same function, because the pro's menu, her
 * bookable locations and her prices can all move between the two
 * ([[re-check-at-execution]]).
 */
export async function loadAuthorizedConsultBookingProposal(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  locationType: ServiceLocationType
  /**
   * B7 — which enhancements this answer is for. REQUIRED, with no default: the
   * two callers want opposite things and neither guess is safe. A client-facing
   * preview passes her own (possibly empty) selection; availability and the
   * hold pass `'ALL'`, because they are reserving space she can still fill in.
   * Defaulting either way would silently give one of them the other's answer.
   */
  enhancementSelection: ConsultBookingProposalEnhancementSelection
  now?: Date
}): Promise<ConsultBookingProposalAvailabilityDTO> {
  return prisma.$transaction(async (tx) => {
    const scope = await requireAuthorizedProposalScope(tx, args)

    const { estimate, analysisRecommendations, lookPlanSafetyRouted } =
      await loadProposalDerivationInputs(tx, scope.id)

    if (estimate?.sourceLookBriefVersion && estimate.sourceLookBriefVersion.selectedLocationType !== args.locationType) {
      return { available: false, reason: 'MODE_NOT_OFFERED', proposal: null, professionalId: scope.professionalId }
    }
    const draft = await buildConsultBookingProposal(tx, {
      professionalId: scope.professionalId,
      serviceCategoryId: scope.serviceCategoryId,
      locationType: args.locationType,
      estimate: toProposalEstimateInput(estimate),
      analysisRecommendations,
      lookPlanSafetyRouted,
      enhancementSelection: args.enhancementSelection,
    })

    if (draft.status === 'REFUSED') {
      return {
        available: false,
        reason: draft.refusalCode,
        proposal: null,
        professionalId: scope.professionalId,
      }
    }

    const proposal = toConsultBookingProposalDTO({
      consultId: scope.id,
      professionalId: scope.professionalId,
      lookPostId: scope.anchorLookPostId,
      draft,
      autoAcceptBookings: scope.professional.autoAcceptBookings,
    })
    if (!proposal) {
      return {
        available: false,
        reason: 'ESTIMATE_REFUSED',
        proposal: null,
        professionalId: scope.professionalId,
      }
    }

    return {
      available: true,
      reason: null,
      proposal,
      professionalId: scope.professionalId,
    }
  })
}
