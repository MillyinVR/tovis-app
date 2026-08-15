// app/pro/portfolio/_data/proPortfolioTypes.ts
//
// The pro's Portfolio — ONE library whose top zone IS the public portfolio.
//
// This screen replaces the old split between `/pro/media` ("My media", where
// adding happened) and `/pro/profile/public-profile?tab=portfolio` (which could
// only remove, because its query was `where: { isFeaturedInPortfolio: true }`).
// The pro used to curate their portfolio from every page except the portfolio
// page. Here the public set is a ZONE of the library, not a separate screen.
//
// 🔴 Every number on this screen is one we actually store. Three things the
// design frame asked for do not exist and are deliberately absent rather than
// faked (Tori's standing rule — a fixture must not flatter the product):
//   - per-photo "Remixes": remix-clicks are explicitly untracked (see the
//     `LookPost` rank-score comment in schema.prisma — views stand in for them).
//   - a video DURATION stamp ("0:14"): `MediaAsset` stores no duration at all.
//   - "Ask for permission" as an action distinct from re-sending the aftercare:
//     they are the same act here, so this DTO exposes one.

import type { MediaType } from '@prisma/client'

import type { PairedBeforeDto } from '@/lib/media/pairedBefore'

/**
 * The zone a photo sits in. This carries public-vs-private INSTEAD of a badge —
 * the old grid drew a `Portfolio` chip that was true of every tile (it was the
 * query's own `where` clause) beside an `Only you` chip that could never be true
 * (publishing derives `visibility: PUBLIC`). Both are gone; position says it.
 */
export type ProPortfolioZone = 'PUBLIC' | 'UPLOADS' | 'SESSIONS'

/**
 * The one mark a tile may carry. A badge appears ONLY where the pro decided
 * something — never for a list position, and never for a fact the zone already
 * states. `SIGNATURE_COVER` is one chip, not two.
 */
export type ProPortfolioMark = 'SIGNATURE' | 'COVER' | 'SIGNATURE_COVER'

/**
 * Why a photo cannot be published yet. This is a CLIENT-safety rule, not a pro
 * permission: a session photo stays private until the client attaches it to a
 * review or ticks media use in their aftercare (`lib/media/publicShareGuard`).
 * Surfacing it on the tile is the point — today it only exists as a 403 the pro
 * meets after tapping.
 */
export type ProPortfolioConsentHold = {
  /** The client whose say-so this waits on. First name only — it's their photo. */
  clientFirstName: string
  /** The booking whose aftercare carries the consent tick, for the nudge action. */
  bookingId: string
  /** Whether an aftercare has been sent at all — a nudge re-issues that link. */
  aftercareSent: boolean
}

/**
 * Live engagement for a PUBLIC photo. Null for anything private, because a
 * photo that has never been public has no numbers rather than zeroed ones —
 * rendering 0s would read as failure instead of absence.
 *
 * All six ride `LookPost`, which is 1:1 with the asset
 * (`LookPost.primaryMediaAssetId` is `@unique`).
 * ⚠️ `views` is incremented by a JOB (`lib/jobs/looksSocial/applyLookViews`),
 * not at read time — it lags. Keep any copy coarse enough to survive that.
 */
export type ProPortfolioEngagement = {
  views: number
  likes: number
  saves: number
  comments: number
  shares: number
  /** Bookings attributed to this look (`Booking.sourceLookPostId`). */
  booked: number
}

export type ProPortfolioTile = {
  id: string
  src: string
  caption: string | null
  isVideo: boolean
  mediaType: MediaType
  serviceIds: string[]
  /** Opt-in before/after pairing → the tile renders a comparison slider. */
  before: PairedBeforeDto | null
  /** The pro's own decision, if any. At most one chip. */
  mark: ProPortfolioMark | null
  /** Set only on PUBLIC tiles. */
  engagement: ProPortfolioEngagement | null
  /** Set only on tiles the client has not released. Publishing is refused. */
  hold: ProPortfolioConsentHold | null
  /** ISO — when this went public. Null while private. */
  publishedAt: string | null
}

/**
 * A private zone, grouped by where the photo CAME FROM. Grouping carries the
 * consent rule once as a group blurb instead of repeating it per tile, and an
 * empty source simply does not render — so nothing looks broken at launch,
 * which matters because review/aftercare photos are real in schema and have
 * zero rows in production today.
 */
export type ProPortfolioGroup = {
  zone: Exclude<ProPortfolioZone, 'PUBLIC'>
  title: string
  blurb: string
  /** Total in this group, which may exceed `tiles.length` (see `remaining`). */
  count: number
  /** Gold note, e.g. "4 waiting". Null when nothing is held. */
  note: string | null
  tiles: ProPortfolioTile[]
  /** How many more exist beyond the page shown. 0 → no "Show more". */
  remaining: number
}

/** A filter chip. `count` is null for chips that don't carry one. */
export type ProPortfolioFilterKey =
  | 'ALL'
  | 'PUBLIC'
  | 'PRIVATE'
  | 'WAITING'
  | 'VIDEO'

export type ProPortfolioFilter = {
  key: ProPortfolioFilterKey
  label: string
  count: number | null
  active: boolean
}

/**
 * The launch-state nudge: photos exist, none are public. Named after what it
 * costs the pro ("nobody can find your work"), and offering only photos that
 * need no client permission — an invitation that can't dead-end in a refusal.
 */
export type ProPortfolioLead = {
  title: string
  body: string
  ctaLabel: string
  /** Up to three ready-to-publish tiles, all consent-free. */
  shots: ProPortfolioTile[]
}

export type ProPortfolioCounts = {
  total: number
  publicCount: number
  privateCount: number
  heldCount: number
}

export type ProPortfolioPageModel = {
  brandDisplayName: string
  routes: ProPortfolioRoutes

  title: string
  /** e.g. "69 photos here. None of them public yet." Derived, never invented. */
  subtitle: string

  counts: ProPortfolioCounts
  filters: ProPortfolioFilter[]
  /** Search only earns its place once the library is large. */
  showSearch: boolean
  activeFilter: ProPortfolioFilterKey
  searchQuery: string | null

  /** Absent (not empty) when nothing is public — the lead card takes its place. */
  publicTiles: ProPortfolioTile[]
  lead: ProPortfolioLead | null
  groups: ProPortfolioGroup[]

  /** True only when the pro owns no media at all. */
  isBlank: boolean

  /** Desktop side rail. */
  coverTile: ProPortfolioTile | null
  signatureTile: ProPortfolioTile | null
  publicProfileHref: string | null
}

export type ProPortfolioRoutes = {
  portfolio: string
  uploadNew: string
  proHome: string
}

export const PRO_PORTFOLIO_ROUTES: ProPortfolioRoutes = {
  portfolio: '/pro/portfolio',
  uploadNew: '/pro/media/new',
  proHome: '/pro',
}

/**
 * Above this many photos the library stops being scannable and search appears.
 * Below it, a chip row plus two groups is enough and a search box is furniture.
 */
export const PRO_PORTFOLIO_SEARCH_THRESHOLD = 60

/** Tiles rendered per group before "Show N more". */
export const PRO_PORTFOLIO_GROUP_PAGE_SIZE = 6
