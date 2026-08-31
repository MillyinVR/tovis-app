// lib/consult/serviceEstimate.ts
//
// Book the Look, slice B3 — THE TRANSLATION MODULE.
//
// From a look-anchored consult that has reached analysis results, to a
// line-item service estimate on THAT pro's own menu: which services, each
// line's price and duration, and the reason the line is there.
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 6, 7 and 11.)
//
// Three rules shape every line below.
//
// 1. NOTHING IS INVENTED (the cold-start rule, decision 7). A line may only
//    name a service that is an active offering on this pro's menu, and its
//    price and duration are read from that offering's own columns. There is no
//    catalog fallback, no "typical" number, no model-authored price — the
//    provider is never asked for money at all. When the pro has not set a
//    price or a duration for the mode, that is a refusal, not a default.
//
// 2. THE LOOK'S OWN SERVICE LINKAGE IS THE FLOOR. B1 took service names off
//    the client-facing feed and kept the linkage (lib/looks/serviceOwnership.ts)
//    precisely as raw material for this. The floor is deterministic: the look's
//    linked service at the pro's listed price. Anything beyond it must carry a
//    rationale tied to ANALYSIS output, which is why beyond-floor lines only
//    ever come from a recommendation the analysis itself resolved to one of
//    this pro's services.
//
// 3. DURATION IS THE DANGEROUS ESTIMATE (decision 11). A price miss is
//    corrected in the chair; a duration miss breaks the pro's day. So each
//    line's minutes come from the same offering columns availability reads, and
//    are rounded UP to the pro's slot granularity — never down, never to the
//    nearest.
//
// If the pro's menu cannot express the look at all, this returns a TYPED
// REFUSAL — the same philosophy as B2's LOOK_SERVICE_UNLINKED. A guess the pro
// has to catch is worse than a refusal she can read.

import 'server-only'

import {
  Prisma,
  ServiceLocationType,
  type ConsultServiceEstimateLineSource,
  type ConsultServiceEstimateRefusalCode,
} from '@prisma/client'

import {
  validateOfferingScheduling,
  resolveBookingLocationContext,
} from '@/lib/booking/locationContext'
import { ceilToStepMinutes, pickModePrice } from '@/lib/booking/serviceItems'
import type {
  ConsultAnalysisPayloadDTO,
  ConsultServiceEstimateDTO,
} from '@/lib/dto/consult'
import { moneyToFixed2String } from '@/lib/money'
import { resolveLookPrimaryService } from '@/lib/looks/serviceOwnership'

import {
  CONSULT_LOOK_ANCHOR_SELECT,
  type ConsultLookAnchorSource,
} from './lookAnchor'
import {
  loadConsultProMenuOfferings,
  type ConsultProMenuOffering,
} from './proMenu'

/** This contract's own version. */
export const CONSULT_SERVICE_ESTIMATE_SCHEMA_VERSION = 1

/**
 * The version of the DERIVATION RULES, not of a prompt — nothing here calls a
 * model. Bump it when the floor rule, the beyond-floor rule, or the rounding
 * changes, so a stored estimate stays interpretable against the rules that
 * produced it once those rules move on.
 */
export const CONSULT_SERVICE_ESTIMATE_DERIVATION_VERSION = 'look-estimate-v1'

/**
 * Which of the pro's two price/duration columns an estimate is read from.
 *
 * A look-anchored consult has not chosen salon or mobile — the booking proposal
 * is B4 — so it reads the SALON column, where a pro's primary prices live. The
 * same reading `analysisContract`'s recommendation lookup already makes, and
 * the chosen mode is stored on the estimate rather than assumed by any reader.
 */
export const CONSULT_LOOK_ESTIMATE_LOCATION_TYPE = ServiceLocationType.SALON

export type ConsultServiceEstimateLineDraft = {
  sortOrder: number
  serviceId: string
  offeringId: string
  serviceName: string
  source: ConsultServiceEstimateLineSource
  rationale: string
  estimatedPrice: Prisma.Decimal
  estimatedDurationMinutes: number
}

export type ConsultServiceEstimateDraft =
  | {
      status: 'ESTIMATED'
      refusalCode: null
      locationType: ServiceLocationType
      stepMinutes: number
      bufferMinutes: number
      lines: ConsultServiceEstimateLineDraft[]
    }
  | {
      status: 'REFUSED'
      refusalCode: ConsultServiceEstimateRefusalCode
      locationType: ServiceLocationType
      stepMinutes: number | null
      bufferMinutes: number | null
      lines: []
    }

/** The analysis material the derivation reads — nothing else from the payload. */
export type ConsultServiceEstimateAnalysisInput = Pick<
  ConsultAnalysisPayloadDTO,
  'recommendations'
>

function refused(
  refusalCode: ConsultServiceEstimateRefusalCode,
  scheduling: { stepMinutes: number; bufferMinutes: number } | null,
): ConsultServiceEstimateDraft {
  return {
    status: 'REFUSED',
    refusalCode,
    locationType: CONSULT_LOOK_ESTIMATE_LOCATION_TYPE,
    stepMinutes: scheduling?.stepMinutes ?? null,
    bufferMinutes: scheduling?.bufferMinutes ?? null,
    lines: [],
  }
}

/**
 * The offering's own price and duration for this mode, or the refusal that
 * explains which of the pro's fields is missing.
 *
 * `validateOfferingScheduling` is the booking context's own reader — the same
 * function that decides whether a real booking may be priced at all — so the
 * estimate refuses on exactly the fields a booking would refuse on. Its
 * `priceStartingAt` is a number, which is fine for its callers and wrong for
 * storage, so the Decimal is taken straight off the column by `pickModePrice`.
 */
function priceLine(
  offering: ConsultProMenuOffering,
  locationType: ServiceLocationType,
  stepMinutes: number,
):
  | { ok: true; price: Prisma.Decimal; durationMinutes: number }
  | { ok: false; refusalCode: ConsultServiceEstimateRefusalCode } {
  const scheduling = validateOfferingScheduling({ offering, locationType })
  if (!scheduling.ok) {
    return {
      ok: false,
      refusalCode:
        scheduling.error === 'MODE_NOT_SUPPORTED'
          ? 'MENU_MODE_UNAVAILABLE'
          : scheduling.error === 'PRICE_REQUIRED'
            ? 'MENU_PRICE_UNSET'
            : 'MENU_DURATION_UNSET',
    }
  }

  const price = pickModePrice({
    locationType,
    salonPriceStartingAt: offering.salonPriceStartingAt,
    mobilePriceStartingAt: offering.mobilePriceStartingAt,
  })
  // `validateOfferingScheduling` proves the column is SET, not that it holds a
  // usable amount: its normalizer accepts any finite number, and nothing
  // constrains the offering's price columns in the database. A NEGATIVE listed
  // price is not a price the pro can have meant, so it is treated as unset
  // rather than propagated into an estimate — or, worse, into a proposal.
  //
  // Exactly ZERO is left alone. A complimentary service is a real thing a pro
  // lists, it adds nothing to the money and it still takes time out of her day,
  // and dropping it would understate the DURATION — the one number decision 11
  // says must never be understated.
  if (price == null || price.isNegative()) {
    return { ok: false, refusalCode: 'MENU_PRICE_UNSET' }
  }

  return {
    ok: true,
    price,
    durationMinutes: ceilToStepMinutes(scheduling.durationMinutes, stepMinutes),
  }
}

function floorRationale(serviceName: string): string {
  return `The look this consult was started from is linked to ${serviceName} on your menu.`
}

function analysisRationale(recommendation: {
  title: string
  rationale: string
}): string {
  return `${recommendation.title} — ${recommendation.rationale}`
}

/**
 * The derivation itself, with every input already resolved. Pure and total: it
 * either returns priced lines or names the reason it could not.
 */
export function deriveConsultServiceEstimate(args: {
  locationType: ServiceLocationType
  stepMinutes: number
  bufferMinutes: number
  menu: readonly ConsultProMenuOffering[]
  /** The look's linked service, from lib/looks/serviceOwnership.ts. */
  floorServiceId: string | null
  analysis: ConsultServiceEstimateAnalysisInput
}): ConsultServiceEstimateDraft {
  const scheduling = {
    stepMinutes: args.stepMinutes,
    bufferMinutes: args.bufferMinutes,
  }

  if (!args.floorServiceId) {
    return refused('LOOK_SERVICE_UNLINKED', scheduling)
  }

  const byServiceId = new Map(
    args.menu.map((offering) => [offering.serviceId, offering]),
  )

  const floorOffering = byServiceId.get(args.floorServiceId)
  if (!floorOffering) {
    return refused('SERVICE_NOT_ON_MENU', scheduling)
  }

  const floorPriced = priceLine(
    floorOffering,
    args.locationType,
    args.stepMinutes,
  )
  if (!floorPriced.ok) {
    return refused(floorPriced.refusalCode, scheduling)
  }

  // Beyond the floor, in the analysis's own order. Only recommendations the
  // analysis ALREADY resolved to one of this pro's services qualify: a
  // SERVICE_CATEGORY reference means the matcher found nothing on her menu, and
  // pricing it would be exactly the invention rule 1 forbids.
  const beyondFloor: ConsultServiceEstimateLineDraft[] = []
  const seen = new Set<string>([args.floorServiceId])
  let floorAnalysisRationale: string | null = null

  for (const recommendation of args.analysis.recommendations) {
    const serviceId =
      recommendation.reference.type === 'SERVICE'
        ? recommendation.reference.serviceId
        : null
    if (!serviceId) continue

    // The analysis pointed at the look's own service. That is not a second
    // line — it is the floor, and this is the analysis reason for it.
    if (serviceId === args.floorServiceId) {
      floorAnalysisRationale ??= analysisRationale(recommendation)
      continue
    }

    if (seen.has(serviceId)) continue
    const offering = byServiceId.get(serviceId)
    if (!offering) continue

    const priced = priceLine(offering, args.locationType, args.stepMinutes)
    // A beyond-floor service the pro has not finished pricing is DROPPED, not
    // refused: the floor is still a true answer, and the brief already shows
    // the direction itself under "Directions to discuss". Only the floor can
    // refuse the whole estimate.
    if (!priced.ok) continue

    seen.add(serviceId)
    beyondFloor.push({
      sortOrder: beyondFloor.length + 1,
      serviceId,
      offeringId: offering.id,
      serviceName: offering.service.name,
      source: 'ANALYSIS_RECOMMENDATION',
      rationale: analysisRationale(recommendation),
      estimatedPrice: priced.price,
      estimatedDurationMinutes: priced.durationMinutes,
    })
  }

  const floorLine: ConsultServiceEstimateLineDraft = {
    sortOrder: 0,
    serviceId: args.floorServiceId,
    offeringId: floorOffering.id,
    serviceName: floorOffering.service.name,
    source: 'LOOK_LINKED_SERVICE',
    rationale: floorAnalysisRationale
      ? `${floorRationale(floorOffering.service.name)} ${floorAnalysisRationale}`
      : floorRationale(floorOffering.service.name),
    estimatedPrice: floorPriced.price,
    estimatedDurationMinutes: floorPriced.durationMinutes,
  }

  return {
    status: 'ESTIMATED',
    refusalCode: null,
    locationType: args.locationType,
    stepMinutes: args.stepMinutes,
    bufferMinutes: args.bufferMinutes,
    lines: [floorLine, ...beyondFloor],
  }
}

/**
 * Resolve every input from the database, then derive.
 *
 * Runs inside the caller's transaction — the analysis finalization holds the
 * session lock, and the estimate must be written from the same consistent read
 * of the pro's menu the recommendations were matched against.
 */
export async function buildConsultServiceEstimate(
  tx: Prisma.TransactionClient,
  args: {
    professionalId: string
    serviceCategoryId: string
    anchorLookPostId: string
    analysis: ConsultServiceEstimateAnalysisInput
  },
): Promise<ConsultServiceEstimateDraft> {
  const locationType = CONSULT_LOOK_ESTIMATE_LOCATION_TYPE

  // Slot granularity and buffer come from the pro's own bookable location —
  // the same ProfessionalLocation columns availability sizes its day against.
  // The timezone is irrelevant to a minute count, so it is not required: an
  // estimate must not refuse for a reason that has nothing to do with the menu.
  const locationContext = await resolveBookingLocationContext({
    tx,
    professionalId: args.professionalId,
    locationType,
    requireValidTimeZone: false,
    fallbackTimeZone: 'UTC',
  })
  if (!locationContext.ok) {
    return refused('PRO_SCHEDULING_NOT_READY', null)
  }
  const { stepMinutes, bufferMinutes } = locationContext.context

  const look: ConsultLookAnchorSource | null = await tx.lookPost.findUnique({
    where: { id: args.anchorLookPostId },
    select: CONSULT_LOOK_ANCHOR_SELECT,
  })

  // The linkage is read through serviceOwnership, never re-derived — and it is
  // read NOW rather than trusted from consult creation, because a look's
  // service can be changed or cleared after the consult was started.
  const floorServiceId = look
    ? resolveLookPrimaryService({
        serviceId: look.serviceId,
        service: look.service,
      }).primaryServiceId
    : null

  const menu = await loadConsultProMenuOfferings(tx, {
    professionalId: args.professionalId,
    serviceCategoryId: args.serviceCategoryId,
  })

  return deriveConsultServiceEstimate({
    locationType,
    stepMinutes,
    bufferMinutes,
    menu,
    floorServiceId,
    analysis: args.analysis,
  })
}

// ── Read side ────────────────────────────────────────────────────────────────

export const CONSULT_SERVICE_ESTIMATE_SELECT = {
  consultSessionId: true,
  status: true,
  refusalCode: true,
  locationType: true,
  stepMinutes: true,
  bufferMinutes: true,
  schemaVersion: true,
  derivationVersion: true,
  sourceAnalysisRevisionId: true,
  createdAt: true,
  lines: {
    select: {
      serviceId: true,
      offeringId: true,
      serviceName: true,
      source: true,
      rationale: true,
      estimatedPrice: true,
      estimatedDurationMinutes: true,
      proFinalPrice: true,
      proFinalDurationMinutes: true,
      proFinalNote: true,
      proFinalAt: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ConsultServiceEstimateSelect

export type ConsultServiceEstimateRow =
  Prisma.ConsultServiceEstimateGetPayload<{
    select: typeof CONSULT_SERVICE_ESTIMATE_SELECT
  }>

export function toConsultServiceEstimateDTO(
  row: ConsultServiceEstimateRow,
): ConsultServiceEstimateDTO {
  return {
    status: row.status,
    refusalCode: row.refusalCode,
    locationType: row.locationType,
    stepMinutes: row.stepMinutes,
    bufferMinutes: row.bufferMinutes,
    schemaVersion: row.schemaVersion,
    derivationVersion: row.derivationVersion,
    sourceAnalysisRevisionId: row.sourceAnalysisRevisionId,
    lines: row.lines.map((line) => ({
      serviceId: line.serviceId,
      offeringId: line.offeringId,
      serviceName: line.serviceName,
      source: line.source,
      rationale: line.rationale,
      // Decimal strings, not JSON numbers: money never round-trips through a
      // float on this wire.
      estimatedPrice: moneyToFixed2String(line.estimatedPrice) ?? '0.00',
      estimatedDurationMinutes: line.estimatedDurationMinutes,
      proFinalPrice: moneyToFixed2String(line.proFinalPrice),
      proFinalDurationMinutes: line.proFinalDurationMinutes,
      proFinalNote: line.proFinalNote,
      proFinalAt: line.proFinalAt?.toISOString() ?? null,
    })),
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Every estimate for a batch of consults, keyed by consult id.
 *
 * Batched deliberately: the pro's client-history surface renders up to 200
 * briefs in one transaction, and a per-brief lookup would be 200 extra round
 * trips for a section most of them do not even have.
 */
export async function loadConsultServiceEstimatesByConsultId(
  tx: Prisma.TransactionClient,
  consultSessionIds: readonly string[],
): Promise<Map<string, ConsultServiceEstimateDTO>> {
  if (consultSessionIds.length === 0) return new Map()

  const rows = await tx.consultServiceEstimate.findMany({
    where: { consultSessionId: { in: [...consultSessionIds] } },
    select: CONSULT_SERVICE_ESTIMATE_SELECT,
  })

  return new Map(
    rows.map((row) => [row.consultSessionId, toConsultServiceEstimateDTO(row)]),
  )
}
