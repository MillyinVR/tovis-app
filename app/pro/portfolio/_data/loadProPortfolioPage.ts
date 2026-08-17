// app/pro/portfolio/_data/loadProPortfolioPage.ts
import 'server-only'

import { redirect } from 'next/navigation'
import { BookingStatus, MediaType, Prisma, Role } from '@prisma/client'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { getCurrentUser } from '@/lib/currentUser'
import { isNonNull } from '@/lib/guards'
import { mapPortfolioTileToDto } from '@/lib/looks/mappers'
import { portfolioTileMediaSelect } from '@/lib/looks/selects'
import { isUnpromotedPrivateMedia } from '@/lib/media/publicShareGuard'
import { reachableClientWhere } from '@/lib/notifications/contactMethod'
import { pickString } from '@/lib/pick'
import { prisma } from '@/lib/prisma'
import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'

import {
  PRO_PORTFOLIO_GROUP_PAGE_SIZE,
  PRO_PORTFOLIO_ROUTES,
  PRO_PORTFOLIO_SEARCH_THRESHOLD,
  type ProPortfolioConsentHold,
  type ProPortfolioCounts,
  type ProPortfolioEngagement,
  type ProPortfolioFilter,
  type ProPortfolioFilterKey,
  type ProPortfolioGroup,
  type ProPortfolioLead,
  type ProPortfolioMark,
  type ProPortfolioPageModel,
  type ProPortfolioTile,
} from './proPortfolioTypes'

/**
 * Hard ceiling on tiles materialised in one render. Counts come from `count()`
 * so they stay exact above this — a truncated GRID is visible ("Show N more"),
 * a truncated COUNT would be a quiet lie.
 */
const TILE_HARD_CAP = 120

const proSelect = Prisma.validator<Prisma.ProfessionalProfileSelect>()({
  id: true,
  handle: true,
  verificationStatus: true,
  coverMediaAssetId: true,
  signatureMediaAssetId: true,
})

/**
 * Everything a tile needs, in ONE read. The three joins are all the tile's own
 * relations, so this stays a single query rather than a per-tile fan-out:
 *  - `lookPostPrimaryFor` is 1:1 (`LookPost.primaryMediaAssetId` is `@unique`)
 *    and carries the engagement counters for a published photo;
 *  - `booking` carries the consent tick, the client's name and whether an
 *    aftercare was ever sent (all three are needed to offer the nudge);
 *  - `beforeAsset` is the opt-in before/after pairing.
 */
const tileSelect = Prisma.validator<Prisma.MediaAssetSelect>()({
  // The media columns + pairing live in ONE place, beside the mapper that
  // resolves them (`portfolioTileMediaSelect`). Restating them here is what let
  // the two pro grids drift apart before this screen merged them.
  ...portfolioTileMediaSelect,
  bookingId: true,
  reviewId: true,
  createdAt: true,
  lookPostPrimaryFor: {
    select: {
      id: true,
      publishedAt: true,
      viewCount: true,
      likeCount: true,
      commentCount: true,
      saveCount: true,
      shareCount: true,
    },
  },
  booking: {
    select: {
      id: true,
      mediaUseConsentAt: true,
      // 🔴 The client's id, not their contact details. Whether they can be
      // reached is answered by a separate id-only query against
      // `reachableClientWhere`, so no contact value is ever selected here.
      clientId: true,
      client: { select: { firstName: true } },
      aftercareSummary: { select: { sentToClientAt: true } },
    },
  },
})

/**
 * 🔴 A `LookPost` can be authored by the CLIENT, and one of those is NOT the
 * pro's to show or to take down.
 *
 * `LookPost.primaryMediaAssetId` points at a `MediaAsset` whose
 * `professionalId` is the pro (it depicts their work), so a naive
 * "has a published look ⇒ the pro published it" read swept every client's post
 * into the pro's public zone. Measured on the dev fixture: 54 tiles claimed as
 * "public", of which 6 were actually on her profile grid — the other 48 were
 * clients' posts, because the profile grid is `proOwnPublicLooksWhere`
 * (`clientAuthorId: null`).
 *
 * That made three separate things lie: the count, the zone's own copy ("exactly
 * what a client sees on your profile"), and — worst — the Take-down button,
 * which returned 200 while `reconcilePortfolioLookForMediaAsset` skipped the
 * retract (`SKIPPED_CLIENT_LOOK`), leaving the look live and the tile in place.
 */
const proOwnMediaWhere = Prisma.validator<Prisma.MediaAssetWhereInput>()({
  lookPostPrimaryFor: { none: { clientAuthorId: { not: null } } },
})

type TileRow = Prisma.MediaAssetGetPayload<{ select: typeof tileSelect }>

type PrimaryLookRow = TileRow['lookPostPrimaryFor'][number]

export type ProPortfolioSearchParams = {
  filter?: string | string[]
  q?: string | string[]
}

/**
 * The RSC entry point: authenticate, then build. `redirect()` throws, so it
 * belongs here and NOT in {@link buildProPortfolioModel} — an API route calling
 * a loader that redirects would answer a native client with a 307 to /login
 * instead of a 401.
 */
export async function loadProPortfolioPage({
  searchParams,
}: {
  searchParams?: ProPortfolioSearchParams | null
}): Promise<ProPortfolioPageModel> {
  const user = await getCurrentUser()

  if (!user || user.role !== Role.PRO || !user.professionalProfile) {
    redirect(
      `/login?from=${encodeURIComponent(PRO_PORTFOLIO_ROUTES.portfolio)}`,
    )
  }

  const model = await buildProPortfolioModel({
    professionalId: user.professionalProfile.id,
    searchParams,
  })

  if (!model) redirect(PRO_PORTFOLIO_ROUTES.proHome)

  return model
}

/**
 * Everything the screen shows, for one pro.
 *
 * 🔴 Shared with `GET /api/v1/pro/portfolio` — that route exists for NATIVE
 * parity, not for the web page, and sharing this function is what stops the two
 * from drifting. iOS previously rendered a different screen entirely
 * (`/api/v1/pro/media`, a two-toggle "My media"), which is exactly the drift
 * this shape prevents. Returns null when the professional row is gone, so the
 * caller decides between a redirect and a 404.
 */
export async function buildProPortfolioModel({
  professionalId,
  searchParams,
}: {
  professionalId: string
  searchParams?: ProPortfolioSearchParams | null
}): Promise<ProPortfolioPageModel | null> {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: professionalId },
    select: proSelect,
  })

  if (!pro) return null

  const activeFilter = pickFilter(searchParams?.filter)
  const searchQuery = pickQuery(searchParams?.q)

  const ownedWhere: Prisma.MediaAssetWhereInput = {
    professionalId: pro.id,
    ...proOwnMediaWhere,
  }

  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: ownedWhere,
      orderBy: { createdAt: 'desc' },
      take: TILE_HARD_CAP,
      select: tileSelect,
    }),
    // Same `where` as the page read, or the header would count rows the grid
    // deliberately never shows.
    prisma.mediaAsset.count({ where: ownedWhere }),
  ])

  // Attributed bookings ("N booked from this photo") for every look on screen,
  // in ONE grouped read rather than a count per tile.
  const lookIds = rows
    .map((row) => resolvePrimaryLook(row)?.id)
    .filter((id): id is string => Boolean(id))

  const bookedByLookId = await countAttributedBookings(lookIds)

  const reachableClientIds = await findReachableClientIds(rows)

  const tiles = (
    await Promise.all(
      rows.map((row) => buildTile(row, pro, bookedByLookId, reachableClientIds)),
    )
  ).filter(isNonNull)

  // A session photo is one attached to a booking; everything else the pro
  // posted themselves. Built once as a Set — a `find` per tile would be O(n²).
  const sessionMediaIds = new Set(
    rows.filter((row) => row.bookingId).map((row) => row.id),
  )

  const matching = tiles.filter(
    (tile) => matchesFilter(tile, activeFilter) && matchesQuery(tile, searchQuery),
  )

  const publicTiles = matching.filter((tile) => tile.publishedAt !== null)
  const privateTiles = matching.filter((tile) => tile.publishedAt === null)

  // Grouping lets the consent rule be stated once per group, not per tile.
  // `UPLOADS`/`SESSIONS` narrow the page to ONE zone, which is where a group's
  // "Show N more" points — so the other zone drops out entirely there.
  const sessions =
    activeFilter === 'UPLOADS'
      ? []
      : privateTiles.filter((tile) => sessionMediaIds.has(tile.id))
  const uploadTiles =
    activeFilter === 'SESSIONS'
      ? []
      : privateTiles.filter((tile) => !sessionMediaIds.has(tile.id))

  const counts = buildCounts(tiles, total)

  const candidates: Array<{
    zone: ProPortfolioGroup['zone']
    title: string
    blurb: string
    tiles: ProPortfolioTile[]
  }> = []

  if (uploadTiles.length > 0) {
    candidates.push({
      zone: 'UPLOADS',
      title: 'Your uploads',
      blurb: 'Shot and posted by you. Yours to publish whenever.',
      tiles: uploadTiles,
    })
  }

  if (sessions.length > 0) {
    candidates.push({
      zone: 'SESSIONS',
      title: 'From sessions',
      blurb:
        'Taken at the chair. Private between you and your client until they allow it.',
      tiles: sessions,
    })
  }

  /**
   * 🔴 A group renders UNCAPPED whenever the page is already showing only that
   * group — not merely when the filter is named after its zone.
   *
   * Keyed on "one group and a narrowed page" rather than on `activeFilter ===
   * zone` because the narrowing filter is often named after something else.
   * Under `WAITING` the sessions group holds 8 held tiles, showed 6, and offered
   * "Show 2 more" — which pointed at `SESSIONS`, a BROADER set of 10. The count
   * was honest about the wrong list, so the control under-promised by exactly
   * the tiles the current filter had excluded.
   */
  const expandAll = activeFilter !== 'ALL' && candidates.length === 1

  const groups: ProPortfolioGroup[] = candidates.map((candidate) =>
    buildGroup({ ...candidate, expanded: expandAll }),
  )

  const isBlank = total === 0
  // 🔴 From the UNFILTERED counts, never from `publicTiles`. The lead card says
  // "your profile has nothing on it, so nobody can find your work" — derived
  // from the filtered set, a pro with 53 public photos met that sentence the
  // moment they tapped "Only you", "Waiting", or typed in the search box.
  const hasPublic = counts.publicCount > 0

  return {
    brandDisplayName: brand.displayName,
    routes: PRO_PORTFOLIO_ROUTES,

    title: 'Portfolio',
    subtitle: buildSubtitle(counts, isBlank),

    counts,
    filters: buildFilters(counts, activeFilter),
    showSearch: total > PRO_PORTFOLIO_SEARCH_THRESHOLD,
    activeFilter,
    searchQuery,

    publicTiles,
    // Offered from every unpublished tile the pro owns, not just the ones the
    // active filter happens to show — the card is about the library, not the view.
    lead:
      hasPublic || isBlank
        ? null
        : buildLead(tiles.filter((tile) => tile.publishedAt === null)),
    groups,

    isBlank,

    publicProfileHref: isPubliclyApprovedProStatus(pro.verificationStatus)
      ? `/professionals/${encodeURIComponent(pro.id)}`
      : null,
  }
}

/**
 * `Booking.sourceLookPostId` is the honest "recreated this" signal — a client
 * who opened this photo and then booked. Cancelled bookings are excluded so the
 * number can only go up for work that actually happened.
 */
async function countAttributedBookings(
  lookIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (lookIds.length === 0) return out

  const grouped = await prisma.booking.groupBy({
    by: ['sourceLookPostId'],
    where: {
      sourceLookPostId: { in: lookIds },
      status: { not: BookingStatus.CANCELLED },
    },
    _count: { _all: true },
  })

  for (const row of grouped) {
    if (!row.sourceLookPostId) continue
    out.set(row.sourceLookPostId, row._count._all)
  }

  return out
}

/**
 * Which of this page's clients can be reached at all, as an id-only read.
 *
 * 🔴 A filter, not a projection: the reachability rule runs in SQL
 * (`reachableClientWhere`) and only ids come back, so a screen that needs to
 * gate one button never selects an email or a phone number. One query for the
 * whole page rather than a lookup per held tile.
 */
async function findReachableClientIds(rows: TileRow[]): Promise<Set<string>> {
  const clientIds = [
    ...new Set(rows.map((row) => row.booking?.clientId).filter(isNonNull)),
  ]

  if (clientIds.length === 0) return new Set()

  const reachable = await prisma.clientProfile.findMany({
    where: { id: { in: clientIds }, ...reachableClientWhere },
    select: { id: true },
  })

  return new Set(reachable.map((client) => client.id))
}

async function buildTile(
  row: TileRow,
  pro: Prisma.ProfessionalProfileGetPayload<{ select: typeof proSelect }>,
  bookedByLookId: Map<string, number>,
  reachableClientIds: Set<string>,
): Promise<ProPortfolioTile | null> {
  const base = await mapPortfolioTileToDto(row)
  if (!base) return null

  const look = resolvePrimaryLook(row)
  const isPublic = Boolean(look?.publishedAt)

  return {
    id: base.id,
    src: base.src,
    caption: base.caption,
    isVideo: base.isVideo,
    mediaType: base.mediaType,
    serviceIds: base.serviceIds,
    before: base.before,
    mark: resolveMark(row.id, pro),
    engagement: isPublic && look ? buildEngagement(look, bookedByLookId) : null,
    hold: resolveHold(row, reachableClientIds),
    publishedAt: look?.publishedAt?.toISOString() ?? null,
  }
}

/**
 * At most ONE chip, and only for something the pro chose. Signature and Cover
 * collapse into a single chip when they're the same photo rather than stacking.
 */
function resolveMark(
  mediaId: string,
  pro: Prisma.ProfessionalProfileGetPayload<{ select: typeof proSelect }>,
): ProPortfolioMark | null {
  const isSignature = mediaId === pro.signatureMediaAssetId
  const isCover = mediaId === pro.coverMediaAssetId

  if (isSignature && isCover) return 'SIGNATURE_COVER'
  if (isSignature) return 'SIGNATURE'
  if (isCover) return 'COVER'

  return null
}

/**
 * `LookPost.primaryMediaAssetId` is `@unique`, so an asset backs at most one
 * look — but Prisma still models the back-relation as a LIST. Reading `[0]` in
 * one helper keeps that quirk from leaking into every call site.
 */
function resolvePrimaryLook(row: TileRow): PrimaryLookRow | null {
  return row.lookPostPrimaryFor[0] ?? null
}

function buildEngagement(
  look: PrimaryLookRow,
  bookedByLookId: Map<string, number>,
): ProPortfolioEngagement {
  return {
    views: normalizeCount(look.viewCount),
    likes: normalizeCount(look.likeCount),
    saves: normalizeCount(look.saveCount),
    comments: normalizeCount(look.commentCount),
    shares: normalizeCount(look.shareCount),
    booked: normalizeCount(bookedByLookId.get(look.id) ?? 0),
  }
}

/**
 * A hold exists when the CLIENT has not released the photo. Reuses the single
 * source of truth for the rule (`isUnpromotedPrivateMedia`) rather than
 * re-deriving it here, so the tile can never disagree with the server that
 * would refuse the publish.
 */
function resolveHold(
  row: TileRow,
  reachableClientIds: Set<string>,
): ProPortfolioConsentHold | null {
  const held = isUnpromotedPrivateMedia({
    bookingId: row.bookingId,
    storageBucket: row.storageBucket,
    reviewId: row.reviewId,
    clientUseConsentAt: row.booking?.mediaUseConsentAt ?? null,
    // 🔴 Deliberately NOT passed, even though the guard accepts it. This call
    // exists to predict what `POST /api/v1/pro/media/[id]/portfolio` will do,
    // and that route does not pass it — so passing it here made the tile claim
    // "ready to publish" on a photo the server answers 403 for. A mirror has to
    // be fed the same inputs as the thing it mirrors; `uploadedByRole` belongs
    // to the CREATE-time invariant (a client publishing their own photo), not
    // to the question "may the PRO publish this".
  })

  if (!held) return null

  // 🔴 A hold with no booking is still a hold. `isUnpromotedPrivateMedia`
  // refuses on the private bucket as an independent second signal, so returning
  // null here put a publish `+` on a tile the server refuses.
  const booking = row.booking
  if (!booking) {
    return {
      clientFirstName: 'your client',
      bookingId: null,
      canNudge: false,
      nudgeBlock: 'NO_BOOKING',
    }
  }

  const aftercareSent = Boolean(booking.aftercareSummary?.sentToClientAt)
  // The delivery boundary needs somewhere to send. Same helper, same fallback
  // chain — so this cannot drift from what the nudge will actually accept.
  const contactable = reachableClientIds.has(booking.clientId)

  const nudgeBlock: ProPortfolioConsentHold['nudgeBlock'] = !aftercareSent
    ? 'NO_AFTERCARE'
    : !contactable
      ? 'NO_CONTACT'
      : null

  return {
    clientFirstName: pickString(booking.client?.firstName) ?? 'your client',
    bookingId: booking.id,
    canNudge: nudgeBlock === null,
    nudgeBlock,
  }
}

function buildGroup(input: {
  zone: ProPortfolioGroup['zone']
  title: string
  blurb: string
  tiles: ProPortfolioTile[]
  expanded: boolean
}): ProPortfolioGroup {
  const shown = input.expanded
    ? input.tiles
    : input.tiles.slice(0, PRO_PORTFOLIO_GROUP_PAGE_SIZE)
  const heldCount = input.tiles.filter((tile) => tile.hold !== null).length

  return {
    zone: input.zone,
    title: input.title,
    blurb: input.blurb,
    count: input.tiles.length,
    note: heldCount > 0 ? `${heldCount} waiting` : null,
    tiles: shown,
    remaining: Math.max(0, input.tiles.length - shown.length),
  }
}

function buildCounts(
  tiles: ProPortfolioTile[],
  total: number,
): ProPortfolioCounts {
  const publicCount = tiles.filter((tile) => tile.publishedAt !== null).length
  const heldCount = tiles.filter((tile) => tile.hold !== null).length

  return {
    total,
    publicCount,
    privateCount: Math.max(0, total - publicCount),
    heldCount,
  }
}

/**
 * States the ratio plainly. At launch the second sentence is the whole point:
 * photos exist and none of them are reachable by a client.
 */
function buildSubtitle(counts: ProPortfolioCounts, isBlank: boolean): string {
  if (isBlank) return 'Nothing here yet.'

  if (counts.publicCount === 0) {
    return `${formatPhotos(counts.total)} here. None of them public yet.`
  }

  return `${counts.publicCount} public · ${counts.privateCount} only you.`
}

function buildFilters(
  counts: ProPortfolioCounts,
  active: ProPortfolioFilterKey,
): ProPortfolioFilter[] {
  // `UPLOADS`/`SESSIONS` have no chip of their own — they narrow the page to one
  // private zone, so "Only you" is the chip that stays lit while you're in one.
  const inPrivateZone =
    active === 'PRIVATE' || active === 'UPLOADS' || active === 'SESSIONS'

  const filters: ProPortfolioFilter[] = [
    { key: 'ALL', label: 'All', count: counts.total, active: active === 'ALL' },
    {
      key: 'PUBLIC',
      label: 'Public',
      count: counts.publicCount,
      active: active === 'PUBLIC',
    },
    {
      key: 'PRIVATE',
      label: 'Only you',
      count: counts.privateCount,
      active: inPrivateZone,
    },
  ]

  // A "Waiting" chip that is always zero teaches the pro nothing — it only
  // appears once something is actually held.
  if (counts.heldCount > 0) {
    filters.push({
      key: 'WAITING',
      label: 'Waiting',
      count: counts.heldCount,
      active: active === 'WAITING',
    })
  }

  return filters
}

function buildLead(candidates: ProPortfolioTile[]): ProPortfolioLead | null {
  // Only offer photos that need no permission — an invitation that ends in a
  // refusal is worse than no invitation.
  const ready = candidates.filter((tile) => tile.hold === null).slice(0, 3)
  if (ready.length === 0) return null

  return {
    title: 'Pick one photo and put it out there.',
    body:
      'Your profile has nothing on it, so nobody can find your work in search or in the feed. ' +
      `${ready.length === 1 ? 'This one is' : `These ${ready.length} are`} ready to go — no client permission needed.`,
    ctaLabel: 'Publish your first Look',
    shots: ready,
  }
}

function matchesFilter(
  tile: ProPortfolioTile,
  filter: ProPortfolioFilterKey,
): boolean {
  if (filter === 'PUBLIC') return tile.publishedAt !== null
  // The two zone filters are PRIVATE plus a zone restriction the caller applies
  // after the split — a tile alone cannot say which zone it lands in.
  if (filter === 'PRIVATE' || filter === 'UPLOADS' || filter === 'SESSIONS') {
    return tile.publishedAt === null
  }
  if (filter === 'WAITING') return tile.hold !== null
  if (filter === 'VIDEO') return tile.mediaType === MediaType.VIDEO

  return true
}

function matchesQuery(tile: ProPortfolioTile, query: string | null): boolean {
  if (!query) return true

  const haystack = [tile.caption, tile.hold?.clientFirstName]
    .filter(isNonNull)
    .join(' ')
    .toLowerCase()

  return haystack.includes(query.toLowerCase())
}

/**
 * Every key except the `ALL` default. `satisfies` keeps this list honest: add a
 * member to `ProPortfolioFilterKey` and forget it here and nothing breaks, but
 * a typo or a removed key fails the build.
 */
const FILTER_KEYS = [
  'PUBLIC',
  'PRIVATE',
  'WAITING',
  'VIDEO',
  'UPLOADS',
  'SESSIONS',
] as const satisfies readonly ProPortfolioFilterKey[]

function isFilterKey(value: string): value is (typeof FILTER_KEYS)[number] {
  return FILTER_KEYS.some((key) => key === value)
}

function pickFilter(value: string | string[] | undefined): ProPortfolioFilterKey {
  const raw = Array.isArray(value) ? value[0] : value

  return typeof raw === 'string' && isFilterKey(raw) ? raw : 'ALL'
}

function pickQuery(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return pickString(raw)
}

function formatPhotos(count: number): string {
  return `${count} ${count === 1 ? 'photo' : 'photos'}`
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}
