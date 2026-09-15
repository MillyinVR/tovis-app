// The pro viral-request wire contract —
// GET /api/v1/pro/viral-requests, and the offer writes under it.
//
// The read half of a loop that has only ever had one end. An approved viral
// look fans out to pros whose services match, and each match has always
// produced a PRO notification — but that notification pointed at
// `/admin/viral-requests/{id}`, a route that 404s even for an admin (removed in
// tovis-app #1189), and there has never been a pro surface of any kind. So the
// platform asked pros to notice an opportunity and gave them nowhere to answer.
//
// `offering` is the field that matters. The client home renders "N pros now
// offer this", and until this contract existed that N counted notification
// DELIVERY rows — pros we managed to tell, not pros who agreed. `offering` is a
// pro's actual answer, and `offeringProCount` is the number the client copy was
// always meant to be about.
//
// As with the consent-form library, the route and `/pro/viral-requests` share
// one loader; this module only makes its output JSON-safe (`approvedAt` and
// `offeredAt` are `Date`s) and declares the shape so the generated schema — and
// therefore the iOS fixtures — can hold it.

import type { ProViralRequestEntry } from '@/lib/viralRequests/proLibrary'

export type ProViralRequestDTO = {
  id: string
  /** The look's name — what the client typed and an admin vetted. */
  name: string
  /** Where it was spotted (TikTok, Instagram, …). Null when none was given. */
  sourceUrl: string | null
  /**
   * The REVIEWER's cover, or null for a gradient. Never the submitter's own
   * attachment — that stays evidence in the admin queue.
   */
  coverImageUrl: string | null
  /** ISO instant, or null if somehow unstamped. */
  approvedAt: string | null
  categoryId: string | null
  categoryName: string | null
  /** This pro currently offers this look. */
  offering: boolean
  /** ISO instant this pro first said so; null when they do not offer it. */
  offeredAt: string | null
  /** Pros currently offering, this one included. Withdrawals are excluded. */
  offeringProCount: number
}

export type ProViralRequestListResponseDTO = {
  requests: ProViralRequestDTO[]
}

/** The single-look response both offer writes return, so a client can re-render. */
export type ProViralRequestOfferResponseDTO = {
  request: ProViralRequestDTO
}

export function buildProViralRequestDTO(
  entry: ProViralRequestEntry,
): ProViralRequestDTO {
  return {
    id: entry.id,
    name: entry.name,
    sourceUrl: entry.sourceUrl,
    coverImageUrl: entry.coverImageUrl,
    approvedAt: entry.approvedAt ? entry.approvedAt.toISOString() : null,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName,
    offering: entry.offering,
    offeredAt: entry.offeredAt ? entry.offeredAt.toISOString() : null,
    offeringProCount: entry.offeringProCount,
  }
}

export function buildProViralRequestListDTO(
  entries: readonly ProViralRequestEntry[],
): ProViralRequestListResponseDTO {
  return { requests: entries.map(buildProViralRequestDTO) }
}
