// lib/consult/proProposalReview.ts
//
// Book the Look, slice B5 — THE PRO'S REVIEW of a booking proposal
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 4, 6 and 7).
//
// A client committed to a look at 3 AM. This is the pro's side of that: what
// she is being asked to accept, why each line is on it, and the one place her
// own numbers get written down.
//
// Four rules shape everything below.
//
// 1. ONE SURFACE, TWO PLACEMENTS. Decision 4's pro half: the `autoAcceptBookings`
//    toggle decides only WHERE the review renders — before the accept/decline
//    she already has, or after a booking it already accepted — never what it
//    says. `placement` is answered HERE, from the booking's own status, so the
//    page cannot decide it a second time and drift.
//
// 2. THE CORRECTION LANDS ON THE ESTIMATE LINE. B3 shipped
//    `ConsultServiceEstimateLine.proFinal*` empty on purpose, with the AI half
//    frozen by trigger and `[serviceId, proFinalAt]` indexed for exactly this
//    read (decision 7). Nothing here fights that: the proposal and its lines are
//    wholly immutable by trigger, and correcting a price by rewriting what the
//    client agreed to is the one thing this slice may not do.
//
// 3. …BUT SHE CORRECTS AGAINST THE PROPOSAL'S NUMBERS, NOT THE ESTIMATE'S. The
//    estimate prices the SALON column, because a look-anchored consult had
//    chosen no mode yet. The proposal line is the mode-reconciled number this
//    client actually saw, so it is the baseline she is shown and the baseline
//    the review status is derived against. The pair stays interpretable because
//    `ConsultBookingProposalLine.estimateLineId` keeps the whole chain
//    (salon estimate → mode-reconciled proposal → pro final) walkable.
//
//    ⚠️ The consequence, stated plainly because it is the sharp edge: an
//    estimate is 1:1 with its consult but can inspire SEVERAL proposals (a
//    client may commit, cancel and commit again off the same analysis). They
//    all share one set of pro-final columns, so the LAST correction wins and a
//    second booking's review opens showing the first one's numbers. That is
//    B4's stated destination for the correction and it is not fought here; the
//    day the moat data needs a pair per COMMITMENT rather than per consult, the
//    columns move to `ConsultBookingProposalLine` and its wholly-immutable
//    trigger is narrowed to leave that half writable.
//
// 4. NOTHING REACHES THE CLIENT. The revision-notice threshold — how far a pro
//    may move a price or a duration before the client is told and offered a
//    cancel/refund — is an OPEN Tori decision (the direction doc's "Still
//    open"). So a correction recorded here changes NO booking field, sends NO
//    notification and moves NO slot. It is a record, and the surface says so
//    plainly rather than implying the client has been told.

import 'server-only'

import {
  BookingStatus,
  Prisma,
  type ConsultServiceEstimateLineSource,
  type ServiceLocationType,
} from '@prisma/client'

import type {
  ConsultProposalDeclinedRecommendationDTO,
  ConsultProposalReviewDTO,
  ConsultProposalReviewLineDTO,
  ConsultProposalReviewLineStatusDTO,
} from '@/lib/dto/consult'
import { formatConsultProposalStartingPrice } from '@/lib/looks/startingPrice'
import { moneyToFixed2String, normalizeMoney2 } from '@/lib/money'
import { prisma } from '@/lib/prisma'

import { isAiConsultC6ExposureEnabledForPro } from './access'
import {
  loadConsultProMenuOfferings,
  type ConsultProMenuOffering,
} from './proMenu'
import { CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH } from './proProposalReviewLimits'
import { priceLine } from './serviceEstimate'

export { CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH } from './proProposalReviewLimits'

export type ProProposalReviewErrorCode =
  | 'HIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'NOT_EDITABLE'
  | 'UNAVAILABLE'

export class ProProposalReviewError extends Error {
  constructor(readonly code: ProProposalReviewErrorCode) {
    super('Consult proposal review unavailable.')
    this.name = 'ProProposalReviewError'
  }
}

/**
 * The booking has not reached a terminal state — it is still an appointment
 * whose numbers can move, so her corrections can still be recorded.
 *
 * IN_PROGRESS is deliberately IN the set even though in-chair finalization is
 * B6's. It is not finalization: nothing here asks the client to approve a new
 * price. Leaving it out was tried and is worse in two ways — it locks the
 * surface at the exact moment a pro learns what the service actually costs
 * (decision 7's "every session close where the pro finalizes prices yields a
 * correction pair" is precisely then), and it would show "this booking is
 * closed" about an appointment that is happening right now, which is simply
 * untrue.
 *
 * COMPLETED, CANCELLED and NO_SHOW are read-only: a correction recorded after
 * the fact is a pair about an appointment nobody can change any more, and
 * decision 7's signal is worth less with those in it.
 */
const EDITABLE_BOOKING_STATUSES: ReadonlySet<BookingStatus> = new Set([
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
])

/**
 * What the pro's recorded numbers say about one line, compared against what the
 * client was sold. Pure, so the surface and the API twin cannot disagree.
 *
 * A line with no `proFinalAt` is NOT_REVIEWED even when it carries numbers —
 * the timestamp is what says a person looked, and B3's columns are nullable
 * together.
 */
export function deriveProposalReviewLineStatus(args: {
  proposedPrice: string
  proposedDurationMinutes: number
  proFinalPrice: string | null
  proFinalDurationMinutes: number | null
  proFinalNote: string | null
  proFinalAt: string | null
}): ConsultProposalReviewLineStatusDTO {
  if (!args.proFinalAt) return 'NOT_REVIEWED'

  const priceMoved =
    args.proFinalPrice !== null && args.proFinalPrice !== args.proposedPrice
  const durationMoved =
    args.proFinalDurationMinutes !== null &&
    args.proFinalDurationMinutes !== args.proposedDurationMinutes

  if (priceMoved || durationMoved) return 'ADJUSTED'
  if (args.proFinalNote) return 'FLAGGED'
  return 'CONFIRMED'
}

/**
 * One line as it is submitted, already narrowed off the wire.
 *
 * `price` is a money STRING for the reason every other money field on this wire
 * is one: a JSON number rounds, and this one is destined for a DECIMAL(10,2)
 * that the database will compare against a client's agreed figure.
 */
export type ProposalReviewLineSubmission = {
  estimateLineId: string
  price: string
  durationMinutes: number
  note: string | null
}

/**
 * Narrow an untrusted body into submissions, or refuse. Pure and total.
 *
 * Deliberately strict about the things a UI cannot get wrong but a script can:
 * duplicate lines (which line wins?), a non-integer duration (a slot is
 * minutes), a negative price (B3's CHECK would refuse it anyway, and refusing
 * here names the reason).
 */
export function parseProposalReviewSubmission(
  value: unknown,
): ProposalReviewLineSubmission[] {
  if (!value || typeof value !== 'object' || !('lines' in value)) {
    throw new ProProposalReviewError('INVALID_REQUEST')
  }
  const raw = (value as { lines: unknown }).lines
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProProposalReviewError('INVALID_REQUEST')
  }

  const seen = new Set<string>()
  const lines: ProposalReviewLineSubmission[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      throw new ProProposalReviewError('INVALID_REQUEST')
    }
    const record = entry as Record<string, unknown>

    const estimateLineId =
      typeof record.estimateLineId === 'string'
        ? record.estimateLineId.trim()
        : ''
    if (!estimateLineId || seen.has(estimateLineId)) {
      throw new ProProposalReviewError('INVALID_REQUEST')
    }
    seen.add(estimateLineId)

    if (typeof record.price !== 'string') {
      throw new ProProposalReviewError('INVALID_REQUEST')
    }
    // `normalizeMoney2` is the repo's one money-string validator; it rejects
    // negatives, exponents and more than two decimal places by construction.
    const price = normalizeMoney2(record.price)
    if (price === null) throw new ProProposalReviewError('INVALID_REQUEST')

    const durationMinutes = record.durationMinutes
    if (
      typeof durationMinutes !== 'number' ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0
    ) {
      throw new ProProposalReviewError('INVALID_REQUEST')
    }

    let note: string | null = null
    if (record.note !== undefined && record.note !== null) {
      if (typeof record.note !== 'string') {
        throw new ProProposalReviewError('INVALID_REQUEST')
      }
      const trimmed = record.note.trim()
      if (trimmed.length > CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH) {
        throw new ProProposalReviewError('INVALID_REQUEST')
      }
      note = trimmed.length ? trimmed : null
    }

    lines.push({ estimateLineId, price, durationMinutes, note })
  }

  return lines
}

/**
 * The proposal, its lines, and the estimate lines they were re-derived from.
 *
 * The estimate line is joined by `estimateLineId` rather than by service: it is
 * the row the correction is written to, and the id the proposal recorded is the
 * only link that survives a pro renaming or replacing a menu row afterwards.
 */
const PROPOSAL_REVIEW_SELECT = {
  id: true,
  bookingId: true,
  consultSessionId: true,
  // B7 — the menu the declined enhancements are re-priced against is the SAME
  // list the estimate and the analysis matcher read (lib/consult/proMenu.ts),
  // and that list is scoped by the consult's own category.
  consultSession: { select: { serviceCategoryId: true, professionalId: true } },
  estimateId: true,
  locationType: true,
  stepMinutes: true,
  bufferMinutes: true,
  totalDurationMinutes: true,
  startingAtPrice: true,
  lines: {
    select: {
      estimateLineId: true,
      serviceId: true,
      offeringId: true,
      serviceName: true,
      source: true,
      price: true,
      durationMinutes: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ConsultBookingProposalSelect

type ProposalReviewRow = Prisma.ConsultBookingProposalGetPayload<{
  select: typeof PROPOSAL_REVIEW_SELECT
}>

type EstimateLineRow = {
  id: string
  sortOrder: number
  serviceId: string
  offeringId: string
  serviceName: string
  rationale: string
  proFinalPrice: Prisma.Decimal | null
  proFinalDurationMinutes: number | null
  proFinalNote: string | null
  proFinalAt: Date | null
}

function toReviewLineDTO(
  line: ProposalReviewRow['lines'][number],
  estimateLine: EstimateLineRow | undefined,
): ConsultProposalReviewLineDTO {
  const proposedPrice = moneyToFixed2String(line.price) ?? '0.00'
  const proFinalPrice = moneyToFixed2String(
    estimateLine?.proFinalPrice ?? null,
  )
  const proFinalAt = estimateLine?.proFinalAt?.toISOString() ?? null
  const proFinalNote = estimateLine?.proFinalNote ?? null
  const proFinalDurationMinutes = estimateLine?.proFinalDurationMinutes ?? null

  return {
    estimateLineId: line.estimateLineId,
    serviceId: line.serviceId,
    offeringId: line.offeringId,
    serviceName: line.serviceName,
    source: line.source as ConsultServiceEstimateLineSource,
    // An estimate line that has gone missing would mean the estimate was
    // deleted out from under a live proposal, which its RESTRICT foreign key
    // forbids. Empty rather than invented: decision 6's "why" is never made up.
    rationale: estimateLine?.rationale ?? '',
    proposedPrice,
    proposedDurationMinutes: line.durationMinutes,
    proFinalPrice,
    proFinalDurationMinutes,
    proFinalNote,
    proFinalAt,
    reviewStatus: deriveProposalReviewLineStatus({
      proposedPrice,
      proposedDurationMinutes: line.durationMinutes,
      proFinalPrice,
      proFinalDurationMinutes,
      proFinalNote,
      proFinalAt,
    }),
  }
}

/**
 * The enhancements the analysis recommended and this client did not take (B7).
 *
 * Pure, so the page and the API twin cannot disagree about what is on offer.
 *
 * Three rules, all of them the same rule the client's side follows:
 *   • RE-PRICED, never read off the estimate. The estimate prices the SALON
 *     column; this booking may be a mobile one, and offering the pro a salon
 *     figure to attach would put the wrong number in front of a client who is
 *     about to approve it (rule 3).
 *   • DROPPED, never invented. A declined line whose offering has left her menu,
 *     or that she no longer prices in this mode, is not offered — she cannot
 *     attach what she cannot sell, and the consultation-proposal route would
 *     refuse the line anyway.
 *   • IN THE ESTIMATE'S OWN ORDER, which is the analysis's order, so the
 *     strongest recommendation is the first thing she sees.
 */
export function deriveDeclinedRecommendations(args: {
  estimateLines: readonly EstimateLineRow[]
  /** The estimate lines that ARE on the booking. */
  committedEstimateLineIds: ReadonlySet<string>
  menu: readonly ConsultProMenuOffering[]
  locationType: ServiceLocationType
  stepMinutes: number
}): ConsultProposalDeclinedRecommendationDTO[] {
  const byOfferingId = new Map(
    args.menu.map((offering) => [offering.id, offering]),
  )

  const declined: ConsultProposalDeclinedRecommendationDTO[] = []

  for (const line of args.estimateLines) {
    if (args.committedEstimateLineIds.has(line.id)) continue

    const offering = byOfferingId.get(line.offeringId)
    if (!offering || offering.serviceId !== line.serviceId) continue

    const priced = priceLine(offering, args.locationType, args.stepMinutes)
    if (!priced.ok) continue

    declined.push({
      estimateLineId: line.id,
      serviceId: line.serviceId,
      offeringId: offering.id,
      // Today's name off her menu, not the estimate's snapshot: she is being
      // shown something to add to an appointment happening now.
      serviceName: offering.service.name,
      rationale: line.rationale,
      price: moneyToFixed2String(priced.price) ?? '0.00',
      durationMinutes: priced.durationMinutes,
    })
  }

  return declined
}

function toReviewDTO(args: {
  proposal: ProposalReviewRow
  estimateLines: ReadonlyMap<string, EstimateLineRow>
  declinedRecommendations: ConsultProposalDeclinedRecommendationDTO[]
  bookingStatus: BookingStatus
}): ConsultProposalReviewDTO {
  const lines = args.proposal.lines.map((line) =>
    toReviewLineDTO(line, args.estimateLines.get(line.estimateLineId)),
  )

  const reviewed = lines.filter((line) => line.reviewStatus !== 'NOT_REVIEWED')

  // Summed in the SERVER's Decimal, never in a float and never in a component:
  // a second total assembled client-side is a second answer about money.
  // A line she has not reviewed stands in at the proposed number, so the total
  // is always "what this appointment is worth as it stands today".
  let proFinalTotalPrice: string | null = null
  let proFinalTotalDurationMinutes: number | null = null
  if (reviewed.length) {
    let price = new Prisma.Decimal(0)
    let minutes = 0
    for (const line of lines) {
      price = price.add(
        new Prisma.Decimal(line.proFinalPrice ?? line.proposedPrice),
      )
      minutes += line.proFinalDurationMinutes ?? line.proposedDurationMinutes
    }
    proFinalTotalPrice = moneyToFixed2String(price) ?? '0.00'
    proFinalTotalDurationMinutes = minutes
  }

  const reviewedAt = reviewed
    .map((line) => line.proFinalAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null

  const startingAtPrice =
    moneyToFixed2String(args.proposal.startingAtPrice) ?? '0.00'

  return {
    bookingId: args.proposal.bookingId,
    consultId: args.proposal.consultSessionId,
    // Rule 1: the booking's own status, which IS what the pro's auto-accept
    // toggle produced. Read once, here.
    placement:
      args.bookingStatus === BookingStatus.PENDING
        ? 'BEFORE_DECISION'
        : 'AFTER_ACCEPTANCE',
    editable: EDITABLE_BOOKING_STATUSES.has(args.bookingStatus),
    locationType: args.proposal.locationType as ServiceLocationType,
    stepMinutes: args.proposal.stepMinutes,
    bufferMinutes: args.proposal.bufferMinutes,
    totalDurationMinutes: args.proposal.totalDurationMinutes,
    startingAtPrice,
    startingAtLabel: formatConsultProposalStartingPrice(
      args.proposal.startingAtPrice,
    ),
    proFinalTotalPrice,
    proFinalTotalDurationMinutes,
    reviewedAt,
    lines,
    declinedRecommendations: args.declinedRecommendations,
  }
}

async function loadEstimateLines(
  tx: Prisma.TransactionClient,
  estimateId: string,
): Promise<Map<string, EstimateLineRow>> {
  const rows = await tx.consultServiceEstimateLine.findMany({
    where: { estimateId },
    select: {
      id: true,
      sortOrder: true,
      serviceId: true,
      offeringId: true,
      serviceName: true,
      rationale: true,
      proFinalPrice: true,
      proFinalDurationMinutes: true,
      proFinalNote: true,
      proFinalAt: true,
    },
    orderBy: { sortOrder: 'asc' },
  })
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * The booking, its proposal and the estimate behind it — authorized.
 *
 * The gate is C6, the same exposure rule the pro brief runs: this surface
 * renders the consult's derivation and its reasons, so it must not be reachable
 * one gate looser than the brief that explains them.
 *
 * Returns null — not an error — when the booking simply has no proposal. Most
 * of a pro's bookings never will, and the page renders nothing rather than an
 * empty section.
 */
async function readAuthorizedProposal(
  tx: Prisma.TransactionClient,
  args: { professionalId: string; bookingId: string },
): Promise<{
  proposal: ProposalReviewRow
  bookingStatus: BookingStatus
} | null> {
  const booking = await tx.booking.findFirst({
    where: { id: args.bookingId, professionalId: args.professionalId },
    select: { id: true, status: true },
  })
  if (!booking) throw new ProProposalReviewError('NOT_FOUND')

  const proposal = await tx.consultBookingProposal.findUnique({
    where: { bookingId: booking.id },
    select: PROPOSAL_REVIEW_SELECT,
  })
  if (!proposal) return null

  return { proposal, bookingStatus: booking.status }
}

/**
 * Everything `toReviewDTO` needs beyond the proposal itself, read inside the
 * caller's transaction. One function, called from both entry points, so the
 * read path and the write path cannot answer differently about what is on
 * offer.
 */
async function loadReviewSideInputs(
  tx: Prisma.TransactionClient,
  proposal: ProposalReviewRow,
): Promise<{
  estimateLines: Map<string, EstimateLineRow>
  declinedRecommendations: ConsultProposalDeclinedRecommendationDTO[]
}> {
  const estimateLines = await loadEstimateLines(tx, proposal.estimateId)

  const committedEstimateLineIds = new Set(
    proposal.lines.map((line) => line.estimateLineId),
  )

  // Skip the menu read entirely when nothing was declined — most proposals, and
  // this surface renders on every pro booking page that has one.
  const hasDeclined = [...estimateLines.values()].some(
    (line) => !committedEstimateLineIds.has(line.id),
  )
  const menu = hasDeclined
    ? await loadConsultProMenuOfferings(tx, {
        professionalId: proposal.consultSession.professionalId,
        serviceCategoryId: proposal.consultSession.serviceCategoryId,
      })
    : []

  return {
    estimateLines,
    declinedRecommendations: deriveDeclinedRecommendations({
      estimateLines: [...estimateLines.values()],
      committedEstimateLineIds,
      menu,
      locationType: proposal.locationType as ServiceLocationType,
      // The granularity this booking was actually sized against, not today's:
      // an attached line must round the same way its neighbours did.
      stepMinutes: proposal.stepMinutes,
    }),
  }
}

export async function loadAuthorizedProProposalReview(args: {
  professionalId: string
  bookingId: string
}): Promise<ConsultProposalReviewDTO | null> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ProProposalReviewError('HIDDEN')
  }

  return prisma.$transaction(async (tx) => {
    const found = await readAuthorizedProposal(tx, args)
    if (!found) return null

    const side = await loadReviewSideInputs(tx, found.proposal)
    return toReviewDTO({
      proposal: found.proposal,
      estimateLines: side.estimateLines,
      declinedRecommendations: side.declinedRecommendations,
      bookingStatus: found.bookingStatus,
    })
  })
}

/**
 * Record the pro's numbers.
 *
 * Every submitted line must belong to THIS proposal — checked against the
 * proposal's own `estimateLineId`s rather than against the estimate, so a pro
 * cannot write a correction onto a line of a different booking's proposal that
 * happens to share an estimate.
 *
 * 🔴 Writes ONLY the pro-final half of the estimate line. No booking field
 * moves, no slot is resized and no notification is sent (rule 4). Re-runnable
 * by design: she may correct her own correction, and the last write wins.
 */
export async function recordProProposalReview(args: {
  professionalId: string
  bookingId: string
  lines: readonly ProposalReviewLineSubmission[]
  now?: Date
}): Promise<ConsultProposalReviewDTO> {
  if (!isAiConsultC6ExposureEnabledForPro(args.professionalId)) {
    throw new ProProposalReviewError('HIDDEN')
  }
  if (args.lines.length === 0) {
    throw new ProProposalReviewError('INVALID_REQUEST')
  }

  const recordedAt = args.now ?? new Date()

  return prisma.$transaction(async (tx) => {
    // Lock the booking first: its status decides whether this write is allowed
    // at all, and a concurrent decline must not slip past between the read and
    // the write ([[re-check-at-execution]]).
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Booking"
      WHERE "id" = ${args.bookingId} AND "professionalId" = ${args.professionalId}
      FOR UPDATE
    `)
    if (locked.length === 0) throw new ProProposalReviewError('NOT_FOUND')

    const found = await readAuthorizedProposal(tx, args)
    if (!found) throw new ProProposalReviewError('NOT_FOUND')
    if (!EDITABLE_BOOKING_STATUSES.has(found.bookingStatus)) {
      throw new ProProposalReviewError('NOT_EDITABLE')
    }

    const ownLineIds = new Set(
      found.proposal.lines.map((line) => line.estimateLineId),
    )
    for (const line of args.lines) {
      if (!ownLineIds.has(line.estimateLineId)) {
        throw new ProProposalReviewError('INVALID_REQUEST')
      }
    }

    for (const line of args.lines) {
      const updated = await tx.consultServiceEstimateLine.updateMany({
        // Scoped by estimate as well as by id: the id came off this proposal's
        // own lines, and this makes the write refuse rather than wander if that
        // ever stops being true.
        where: {
          id: line.estimateLineId,
          estimateId: found.proposal.estimateId,
        },
        data: {
          proFinalPrice: new Prisma.Decimal(line.price),
          proFinalDurationMinutes: line.durationMinutes,
          proFinalNote: line.note,
          proFinalAt: recordedAt,
        },
      })
      if (updated.count !== 1) {
        throw new ProProposalReviewError('NOT_FOUND')
      }
    }

    const side = await loadReviewSideInputs(tx, found.proposal)
    return toReviewDTO({
      proposal: found.proposal,
      estimateLines: side.estimateLines,
      declinedRecommendations: side.declinedRecommendations,
      bookingStatus: found.bookingStatus,
    })
  })
}
