// app/pro/portfolio/_data/loadProPortfolioPage.ts
import 'server-only'

import { redirect } from 'next/navigation'
import { BookingStatus, MediaType, Prisma, Role } from '@prisma/client'

import { getBrandConfig } from '@/lib/brand'
import { getCurrentUser } from '@/lib/currentUser'
import { isNonNull } from '@/lib/guards'
import { mapPortfolioTileToDto } from '@/lib/looks/mappers'
import { portfolioTileMediaSelect } from '@/lib/looks/selects'
import { isUnpromotedPrivateMedia } from '@/lib/media/publicShareGuard'
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
  uploadedByRole: true,
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
      client: { select: { firstName: true } },
      aftercareSummary: { select: { sentToClientAt: true } },
    },
  },
})

type TileRow = Prisma.MediaAssetGetPayload<{ select: typeof tileSelect }>

type PrimaryLookRow = TileRow['lookPostPrimaryFor'][number]

export type ProPortfolioSearchParams = {
  filter?: string | string[]
  q?: string | string[]
}

export async function loadProPortfolioPage({
  searchParams,
}: {
  searchParams?: ProPortfolioSearchParams | null
}): Promise<ProPortfolioPageModel> {
  const user = await getCurrentUser()
  const brand = getBrandConfig()

  if (!user || user.role !== Role.PRO || !user.professionalProfile) {
    redirect(
      `/login?from=${encodeURIComponent(PRO_PORTFOLIO_ROUTES.portfolio)}`,
    )
  }

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: user.professionalProfile.id },
    select: proSelect,
  })

  if (!pro) redirect(PRO_PORTFOLIO_ROUTES.proHome)

  const activeFilter = pickFilter(searchParams?.filter)
  const searchQuery = pickQuery(searchParams?.q)

  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where: { professionalId: pro.id },
      orderBy: { createdAt: 'desc' },
      take: TILE_HARD_CAP,
      select: tileSelect,
    }),
    prisma.mediaAsset.count({ where: { professionalId: pro.id } }),
  ])

  // Attributed bookings ("N booked from this photo") for every look on screen,
  // in ONE grouped read rather than a count per tile.
  const lookIds = rows
    .map((row) => resolvePrimaryLook(row)?.id)
    .filter((id): id is string => Boolean(id))

  const bookedByLookId = await countAttributedBookings(lookIds)

  const tiles = (
    await Promise.all(
      rows.map((row) => buildTile(row, pro, bookedByLookId)),
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
  const sessions = privateTiles.filter((tile) => sessionMediaIds.has(tile.id))
  const uploadTiles = privateTiles.filter((tile) => !sessionMediaIds.has(tile.id))

  const counts = buildCounts(tiles, total)

  const groups: ProPortfolioGroup[] = []

  if (uploadTiles.length > 0) {
    groups.push(
      buildGroup({
        zone: 'UPLOADS',
        title: 'Your uploads',
        blurb: 'Shot and posted by you. Yours to publish whenever.',
        tiles: uploadTiles,
      }),
    )
  }

  if (sessions.length > 0) {
    groups.push(
      buildGroup({
        zone: 'SESSIONS',
        title: 'From sessions',
        blurb:
          'Taken at the chair. Private between you and your client until they allow it.',
        tiles: sessions,
      }),
    )
  }

  const isBlank = total === 0
  const hasPublic = publicTiles.length > 0

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
    lead: hasPublic || isBlank ? null : buildLead(uploadTiles),
    groups,

    isBlank,

    coverTile: tiles.find((tile) => tile.id === pro.coverMediaAssetId) ?? null,
    signatureTile:
      tiles.find((tile) => tile.id === pro.signatureMediaAssetId) ?? null,
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

async function buildTile(
  row: TileRow,
  pro: Prisma.ProfessionalProfileGetPayload<{ select: typeof proSelect }>,
  bookedByLookId: Map<string, number>,
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
    hold: resolveHold(row),
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
function resolveHold(row: TileRow): ProPortfolioConsentHold | null {
  const held = isUnpromotedPrivateMedia({
    bookingId: row.bookingId,
    storageBucket: row.storageBucket,
    reviewId: row.reviewId,
    clientUseConsentAt: row.booking?.mediaUseConsentAt ?? null,
    uploadedByRole: row.uploadedByRole,
  })

  if (!held) return null
  if (!row.booking) return null

  return {
    clientFirstName: pickString(row.booking.client?.firstName) ?? 'your client',
    bookingId: row.booking.id,
    aftercareSent: Boolean(row.booking.aftercareSummary?.sentToClientAt),
  }
}

function buildGroup(input: {
  zone: ProPortfolioGroup['zone']
  title: string
  blurb: string
  tiles: ProPortfolioTile[]
}): ProPortfolioGroup {
  const shown = input.tiles.slice(0, PRO_PORTFOLIO_GROUP_PAGE_SIZE)
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
      active: active === 'PRIVATE',
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
  if (filter === 'PRIVATE') return tile.publishedAt === null
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

function pickFilter(value: string | string[] | undefined): ProPortfolioFilterKey {
  const raw = Array.isArray(value) ? value[0] : value

  if (raw === 'PUBLIC' || raw === 'PRIVATE' || raw === 'WAITING' || raw === 'VIDEO') {
    return raw
  }

  return 'ALL'
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
