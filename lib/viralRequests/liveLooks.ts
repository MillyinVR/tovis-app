// lib/viralRequests/liveLooks.ts
//
// What counts as a LIVE viral look, who counts as OFFERING it, and the client's
// read of both. One module, because the whole defect this replaces was two
// surfaces answering the same question differently.
//
// ── The bug this exists to kill ────────────────────────────────────────────
//
// The client home has always rendered "N pros now offer this", and N counted
// `ViralRequestApprovalFanOut` rows — DELIVERY records. A fan-out row means we
// managed to NOTIFY a pro whose services matched; it says nothing about whether
// that pro ever agreed. So the product told clients that pros offer a look when
// not one of them had said so. `ViralRequestProOffer` (tovis-app #1191) is the
// pro's actual answer, and `OFFERING_PRO_OFFER_WHERE` below is the single
// definition of "offering" that every surface now reads.
//
// The count and the list are the same query shape on purpose. A client who taps
// a look that claims six pros must find six pros — if the number and the names
// came from two predicates they would drift the first time either changed.
import {
  ModerationStatus,
  Prisma,
  type ProfessionType,
  ViralServiceRequestStatus,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { PUBLICLY_LISTABLE_PRO_STATUSES } from '@/lib/proTrustState'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant/visibility'
import { resolveViralCoverImage } from '@/lib/viralRequests/contracts'

/**
 * A look is live — approved, moderation-clean, not pulled.
 *
 * The client home, the pro library and this module's client read all compose
 * THIS constant rather than spelling the three fields out, so a look can never
 * be visible on one surface and gone from another. A pro must not be asked to
 * offer something a client cannot see, and a client must not be shown a look a
 * moderator has removed.
 */
export const LIVE_VIRAL_REQUEST_WHERE = {
  status: ViralServiceRequestStatus.APPROVED,
  moderationStatus: ModerationStatus.APPROVED,
  removedAt: null,
} as const satisfies Prisma.ViralServiceRequestWhereInput

/**
 * A pro currently offers this look, AND may be shown to a client.
 *
 * Two conditions, both load-bearing:
 *
 * - `withdrawnAt: null` — withdrawal STAMPS rather than deletes (the unique
 *   (request, pro) pair keeps re-offering idempotent), so an unfiltered read
 *   would count pros who have since changed their mind.
 * - the pro is publicly listable — the same `PUBLICLY_LISTABLE_PRO_STATUSES`
 *   gate the approval matching itself ran. A pro can be REJECTED or put in
 *   NEEDS_INFO *after* opting in, and without this the look's page would hand a
 *   client a pro the marketplace has barred. Eligibility is re-checked at READ
 *   time because nothing revisits the offer row when a status changes.
 *
 * ⚠️ Every count and every list of offering pros composes this. Two callers
 * with two hand-written predicates is exactly how the count and the list drift.
 */
export const OFFERING_PRO_OFFER_WHERE =
  Prisma.validator<Prisma.ViralRequestProOfferWhereInput>()({
    withdrawnAt: null,
    professional: {
      // Viral looks are a tovis-root marketplace feature and fan out across all
      // tenants by design — same call the matching query makes. Thread a real
      // TenantContext here if viral requests ever become tenant-facing.
      ...platformCrossTenantProVisibilityFilter(),
      verificationStatus: { in: [...PUBLICLY_LISTABLE_PRO_STATUSES] },
    },
  })

/**
 * The `_count` fragment for "pros now offer this" — the number the client copy
 * was always meant to be about. Drop this into any `ViralServiceRequestSelect`.
 */
export const offeringProCountSelect =
  Prisma.validator<Prisma.ViralServiceRequestCountOutputTypeDefaultArgs>()({
    select: { proOffers: { where: OFFERING_PRO_OFFER_WHERE } },
  })

/**
 * How many opted-in pros a single look's page will name at once.
 *
 * A cap rather than a page, because the honest number is carried separately:
 * `offeringProCount` is counted with the SAME predicate, so a truncated list
 * still reports its true total and the page can say how many it is not showing.
 */
export const CLIENT_VIRAL_LOOK_PRO_LIMIT = 60

export type ClientViralLookPro = {
  id: string
  /** Privacy-resolved public display name — never a raw first/last read. */
  name: string
  handle: string | null
  avatarUrl: string | null
  professionType: ProfessionType | null
  location: string | null
  isPremium: boolean
  /** When this pro first said "I can do this". */
  offeredAt: Date
}

export type ClientViralLook = {
  id: string
  name: string
  sourceUrl: string | null
  /** The REVIEWER's cover, or null for a gradient. Never submitter evidence. */
  coverImage: string | null
  approvedAt: Date | null
  categoryName: string | null
  /** Opted-in, listable pros — at most `CLIENT_VIRAL_LOOK_PRO_LIMIT` of them. */
  pros: ClientViralLookPro[]
  /** The TRUE total, counted with the same predicate the list filters on. */
  offeringProCount: number
}

/**
 * One live viral look and the pros who explicitly opted into it.
 *
 * Tori, 2026-09-15: tapping a look leads to the professionals who opted in,
 * with a path toward booking — replacing the old `/search?q={name}` guess,
 * which returned whatever the text matched rather than anyone who had agreed.
 *
 * Returns null for a look that is missing, unapproved, or pulled, so the caller
 * renders a 404 rather than a page about a look nobody is allowed to see.
 *
 * 🔴 `mediaUrlsJson` is deliberately NOT selected. The submitter's attachment is
 * evidence for the admin queue; only an admin-chosen cover publishes
 * (`resolveViralCoverImage`).
 */
export async function loadLiveViralLookForClient(
  viralRequestId: string,
): Promise<ClientViralLook | null> {
  const row = await prisma.viralServiceRequest.findFirst({
    where: { id: viralRequestId, ...LIVE_VIRAL_REQUEST_WHERE },
    select: {
      id: true,
      name: true,
      sourceUrl: true,
      coverImageUrl: true,
      approvedAt: true,
      requestedCategory: { select: { name: true } },
      proOffers: {
        where: OFFERING_PRO_OFFER_WHERE,
        // Premium first, then whoever said yes earliest — the marketplace's
        // existing pro ordering (`findMatchingProsByRequestedCategory`) with a
        // tiebreak that rewards committing early rather than an opaque id sort.
        orderBy: [{ professional: { isPremium: 'desc' } }, { createdAt: 'asc' }],
        take: CLIENT_VIRAL_LOOK_PRO_LIMIT,
        select: {
          createdAt: true,
          professional: {
            select: {
              id: true,
              ...professionalPublicDisplayNameSelect,
              avatarUrl: true,
              professionType: true,
              location: true,
              isPremium: true,
            },
          },
        },
      },
      _count: offeringProCountSelect,
    },
  })

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl,
    coverImage: resolveViralCoverImage(row),
    approvedAt: row.approvedAt,
    categoryName: row.requestedCategory?.name ?? null,
    pros: row.proOffers.map((offer) => ({
      id: offer.professional.id,
      // The canonical privacy-aware resolver — it honours the pro's own
      // nameDisplay choice, so this page cannot expose a real name a pro has
      // asked the marketplace not to show.
      name: formatProfessionalPublicDisplayName(offer.professional),
      handle: offer.professional.handle,
      avatarUrl: offer.professional.avatarUrl,
      professionType: offer.professional.professionType,
      location: offer.professional.location,
      isPremium: offer.professional.isPremium,
      offeredAt: offer.createdAt,
    })),
    offeringProCount: row._count.proOffers,
  }
}
