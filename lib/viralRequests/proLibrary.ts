// lib/viralRequests/proLibrary.ts
//
// The PRO's half of viral looks: the approved looks this pro was matched to,
// and whether they have said "I can do this".
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The fan-out has always told matched pros that an approved viral look matches
// their services (`VIRAL_REQUEST_APPROVED`), and the client home has always
// rendered "N pros now offer this" underneath the look. Neither statement was
// backed by anything a pro did: the notification pointed at an admin route that
// 404s (tovis-app #1189), and N counted `ViralRequestApprovalFanOut` rows —
// DELIVERY records, i.e. pros we managed to notify, not pros who agreed.
//
// `ViralRequestProOffer` is the missing fact, and this module is the one place
// that reads and writes it. Both the API route and the page use these functions
// so the two surfaces cannot disagree about what "offering" means — the same
// reuse `loadProConsentFormLibrary` was extracted for.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  LIVE_VIRAL_REQUEST_WHERE,
  offeringProCountSelect,
} from '@/lib/viralRequests/liveLooks'

export function proViralRequestSelect(professionalId: string) {
  return Prisma.validator<Prisma.ViralServiceRequestSelect>()({
    id: true,
    name: true,
    sourceUrl: true,
    approvedAt: true,
    // The reviewer's pick only. `mediaUrlsJson` is the submitter's unvetted
    // attachment and stays evidence in the admin queue — the same rule the
    // client surfaces follow.
    coverImageUrl: true,
    requestedCategory: {
      select: { id: true, name: true },
    },
    // This pro's own answer. The unique pair means at most one row, so `take`
    // is belt-and-braces rather than a real limit.
    proOffers: {
      where: { professionalId },
      select: { withdrawnAt: true, createdAt: true },
      take: 1,
    },
    // The SAME count the client sees — `offeringProCountSelect` is the one
    // definition of "pros now offer this". An unfiltered count here would
    // reproduce the exact bug `ViralRequestProOffer` was added to fix, just one
    // table over, and a pro would be quoted a number no client ever sees.
    _count: offeringProCountSelect,
  })
}

export type ProViralRequestRow = Prisma.ViralServiceRequestGetPayload<{
  select: ReturnType<typeof proViralRequestSelect>
}>

export type ProViralRequestEntry = {
  id: string
  name: string
  sourceUrl: string | null
  coverImageUrl: string | null
  approvedAt: Date | null
  categoryId: string | null
  categoryName: string | null
  /**
   * This pro has an active offer on this look.
   *
   * Deliberately NOT gated on being publicly listable, unlike the count beside
   * it: this is the pro's own answer, and a pro whose verification lapsed
   * should still see what they said and be able to withdraw it. They simply
   * stop being one of the pros a CLIENT is shown until the status clears.
   */
  offering: boolean
  /** When they first said so, null if they never have. */
  offeredAt: Date | null
  /** Pros currently offering, this one included. */
  offeringProCount: number
}

export function toProViralRequestEntry(
  row: ProViralRequestRow,
): ProViralRequestEntry {
  const offer = row.proOffers[0] ?? null

  return {
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl,
    coverImageUrl: row.coverImageUrl,
    approvedAt: row.approvedAt,
    categoryId: row.requestedCategory?.id ?? null,
    categoryName: row.requestedCategory?.name ?? null,
    offering: offer !== null && offer.withdrawnAt === null,
    offeredAt: offer !== null && offer.withdrawnAt === null ? offer.createdAt : null,
    offeringProCount: row._count.proOffers,
  }
}

export const PRO_VIRAL_REQUEST_PAGE_SIZE = 50

/**
 * The approved viral looks this pro was MATCHED to, newest approval first.
 *
 * Scoped to the fan-out rather than to every approved look: the match is what
 * makes the look relevant (it ran against this pro's own services), and a list
 * of everything approved would be a platform feed, not the pro's inbox. A pro
 * who was never matched sees an empty list, not somebody else's category.
 */
export async function loadProViralRequestLibrary(
  professionalId: string,
  limit: number = PRO_VIRAL_REQUEST_PAGE_SIZE,
): Promise<ProViralRequestEntry[]> {
  const rows = await prisma.viralServiceRequest.findMany({
    where: {
      ...LIVE_VIRAL_REQUEST_WHERE,
      approvalFanOuts: { some: { professionalId } },
    },
    orderBy: { approvedAt: 'desc' },
    take: limit,
    select: proViralRequestSelect(professionalId),
  })

  return rows.map(toProViralRequestEntry)
}

export type ProViralOfferResult =
  | { ok: true; entry: ProViralRequestEntry }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_MATCHED' }

/**
 * The gate BOTH writes run, so opting in and withdrawing cannot drift apart.
 *
 * Two separate refusals, deliberately reported the same way to the caller:
 * the look must be live, and this pro must have been matched to it. Without the
 * second check any pro could opt into any approved look by id — the fan-out is
 * the only thing that ever established relevance, and a pro-supplied id is not
 * evidence of it.
 */
async function loadMatchedLiveRequestId(args: {
  professionalId: string
  viralRequestId: string
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'NOT_MATCHED' }> {
  const row = await prisma.viralServiceRequest.findFirst({
    where: { id: args.viralRequestId, ...LIVE_VIRAL_REQUEST_WHERE },
    select: {
      id: true,
      approvalFanOuts: {
        where: { professionalId: args.professionalId },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!row) return { ok: false, reason: 'NOT_FOUND' }
  if (row.approvalFanOuts.length === 0) return { ok: false, reason: 'NOT_MATCHED' }
  return { ok: true }
}

async function readEntry(args: {
  professionalId: string
  viralRequestId: string
}): Promise<ProViralRequestEntry | null> {
  const row = await prisma.viralServiceRequest.findUnique({
    where: { id: args.viralRequestId },
    select: proViralRequestSelect(args.professionalId),
  })
  return row ? toProViralRequestEntry(row) : null
}

/**
 * "I can do this."
 *
 * Idempotent by construction: the unique (request, pro) pair means a second tap
 * re-activates the SAME row rather than creating a duplicate, and re-opting in
 * after a withdrawal clears `withdrawnAt` instead of leaving a second history.
 * `createdAt` is deliberately NOT reset — it is when this pro first said yes.
 */
export async function offerViralRequestAsPro(args: {
  professionalId: string
  viralRequestId: string
}): Promise<ProViralOfferResult> {
  const gate = await loadMatchedLiveRequestId(args)
  if (!gate.ok) return gate

  await prisma.viralRequestProOffer.upsert({
    where: {
      viralServiceRequestId_professionalId: {
        viralServiceRequestId: args.viralRequestId,
        professionalId: args.professionalId,
      },
    },
    create: {
      viralServiceRequestId: args.viralRequestId,
      professionalId: args.professionalId,
    },
    update: { withdrawnAt: null },
    select: { id: true },
  })

  const entry = await readEntry(args)
  return entry ? { ok: true, entry } : { ok: false, reason: 'NOT_FOUND' }
}

/**
 * "Actually, no."
 *
 * Stamps `withdrawnAt` rather than deleting, so the pair stays unique and a
 * later re-offer is still the same row. Withdrawing something never offered is
 * a no-op success — the caller asked for a state, and that state now holds.
 */
export async function withdrawViralRequestOfferAsPro(args: {
  professionalId: string
  viralRequestId: string
}): Promise<ProViralOfferResult> {
  const gate = await loadMatchedLiveRequestId(args)
  if (!gate.ok) return gate

  await prisma.viralRequestProOffer.updateMany({
    where: {
      viralServiceRequestId: args.viralRequestId,
      professionalId: args.professionalId,
      withdrawnAt: null,
    },
    data: { withdrawnAt: new Date() },
  })

  const entry = await readEntry(args)
  return entry ? { ok: true, entry } : { ok: false, reason: 'NOT_FOUND' }
}
