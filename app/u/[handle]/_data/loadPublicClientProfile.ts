// app/u/[handle]/_data/loadPublicClientProfile.ts
import 'server-only'

import {
  BoardVisibility,
  BookingStatus,
  ClientCreatorTier,
  Prisma,
} from '@prisma/client'

import {
  buildCreatorStanding,
  CREATOR_STANDING_SELECT,
  type CreatorStandingValue,
} from '@/lib/clients/creatorStanding'
import { getViewerClientFollowState } from '@/lib/follows'
import { asTrimmedString } from '@/lib/guards'
import { normalizeHandle } from '@/lib/handles'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'
import { formatLookStartingPrice } from '@/lib/looks/startingPrice'
import {
  boardVisibleLookItemWhere,
  publicLookVisibilityWhere,
} from '@/lib/looks/selects'
import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { renderMediaUrlsBatch } from '@/lib/media/renderUrls'

/** How many board cover tiles the mosaic shows. */
const BOARD_TILE_COUNT = 4

export type PublicClientLook = {
  id: string
  name: string
  imageUrl: string | null
  saveCount: number
  href: string
  /** The pro whose work the look shows — "Noor Haddad · Balayage". */
  proName: string
  // ⚠️ The `proName` doc above still shows the card line as
  // "Noor Haddad · Balayage" — that composition is GONE. Book the Look (B1)
  // took service names off every client-facing look surface, so the card now
  // renders `proName` alone. (The JSDoc is left as-is deliberately: it is
  // published verbatim into schema/api/tovis-api.schema.json, and B1 ships no
  // schema change.)
  //
  // ⚠️ BACKSTAGE, deliberately unrendered — but the field STAYS on the wire:
  // this type is re-exported through `lib/dto/index.ts`, shipped iOS builds
  // read it, and the look↔service linkage is raw material for the translation
  // module (B3). Do not "clean up" as dead — removing it breaks the API.
  serviceName: string | null
  /**
   * Already composed as "From $250". Never a bare figure: a look's price is a
   * STARTING price and a consultation can revise the total (Tori's standing
   * rule). Null when the look carries no price at all.
   */
  priceLabel: string | null
  /** Bookings that cite this look as their source — "12 recreated this". */
  recreatedCount: number
  /**
   * A SUPER_ADMIN promoted this look into the editorial Spotlight
   * (LookPost.featuredAt). The design frame labels this badge "Viral"; we label
   * it "Spotlight" because an admin picked it — calling an editorial choice
   * "Viral" claims an engagement event that never happened.
   */
  spotlighted: boolean
  /** Opens the look with its availability drawer already open. */
  recreateHref: string
}

export type PublicClientBoard = {
  id: string
  name: string
  slug: string
  href: string
  /** REAL number of publicly-visible looks on the board. */
  itemCount: number
  /** Up to {@link BOARD_TILE_COUNT} cover images; may be shorter. */
  tileImageUrls: string[]
}

export type PublicClientProfileViewer = {
  /** The signed-in client is looking at their OWN profile. */
  isOwn: boolean
  /** The signed-in client already follows this profile. */
  following: boolean
}

/**
 * A creator's standing. An alias, not a second declaration: `/client/me` shows
 * the owner the same thing, and one shape with one name is what stops the two
 * surfaces describing it differently.
 */
export type PublicClientProfileStanding = CreatorStandingValue

export type PublicClientProfileData = {
  handle: string
  displayName: string
  avatarUrl: string | null
  bio: string | null
  standing: PublicClientProfileStanding
  counts: { followers: number; following: number; looks: number }
  looks: PublicClientLook[]
  boards: PublicClientBoard[]
  viewer: PublicClientProfileViewer
}

/**
 * Loads a client's PUBLIC creator profile by handle. Returns null when the handle
 * doesn't resolve or the client hasn't opted into a public profile — the page
 * turns that into a 404 (a private/non-existent profile is indistinguishable).
 */
export async function loadPublicClientProfile(
  handleParam: string,
  options?: { viewerClientId?: string | null },
): Promise<PublicClientProfileData | null> {
  const normalized = normalizeHandle(handleParam)
  if (!normalized) return null

  return loadPublicClientProfileWhere({ handleNormalized: normalized }, options)
}

/**
 * Same public profile, keyed by clientId instead of handle. Used by the
 * pro-facing client chart's "public profile" view (the pro already knows the
 * client by id, not handle). Shares one body with {@link loadPublicClientProfile}
 * — same null contract (not public / no handle → null → empty state).
 */
export async function loadPublicClientProfileByClientId(
  clientId: string,
  options?: { viewerClientId?: string | null },
): Promise<PublicClientProfileData | null> {
  const id = asTrimmedString(clientId)
  if (!id) return null

  return loadPublicClientProfileWhere({ id }, options)
}

async function loadPublicClientProfileWhere(
  where: Prisma.ClientProfileWhereUniqueInput,
  options?: { viewerClientId?: string | null },
): Promise<PublicClientProfileData | null> {
  // Scoped to this client via the relation (not a cross-tenant lookPost discovery
  // read): the profile only ever shows its OWN author's PUBLIC published looks.
  const client = await prisma.clientProfile.findUnique({
    where,
    select: {
      id: true,
      handle: true,
      // Public profiles are addressed and displayed by HANDLE, not legal name —
      // we deliberately do NOT surface firstName/lastName to strangers.
      avatarUrl: true,
      publicBio: true,
      isPublicProfile: true,
      // Derived standing (lib/clients/creatorTier.ts). Absent until the hourly
      // job has scored this client; absence renders as no badge. The columns
      // and the null-handling are shared with /client/me — see
      // lib/clients/creatorStanding.ts.
      ...CREATOR_STANDING_SELECT,
      _count: {
        select: {
          followers: true,
          following: true,
        },
      },
      authoredLooks: {
        // §19c — the moderation gate is part of `publicLookVisibilityWhere`:
        // client-authored looks are created PENDING_REVIEW (clientLookService),
        // so filtering only status+visibility exposed them on this public grid
        // before a human approved them (§19 divergence a — pre-moderation public
        // exposure). Sharing the clause with the pro portfolio is what keeps this
        // surface and the global feed admitting the same rows.
        where: publicLookVisibilityWhere,
        orderBy: { publishedAt: 'desc' },
        take: 60,
        select: {
          id: true,
          caption: true,
          saveCount: true,
          priceStartingAt: true,
          featuredAt: true,
          // The approved select that feeds formatProfessionalPublicDisplayName —
          // imported rather than restated, so the name fields are only ever read
          // through lib/privacy's own helper (check:pii-plaintext-reads) and the
          // pro's nameDisplay preference can't be dropped by a hand-written copy.
          professional: { select: professionalPublicDisplayNameSelect },
          service: { select: { name: true } },
          primaryMediaAsset: {
            select: {
              storageBucket: true,
              storagePath: true,
              thumbBucket: true,
              thumbPath: true,
              url: true,
              thumbUrl: true,
            },
          },
        },
      },
      // Only SHARED, un-hidden boards are public — the same gate the standalone
      // public board page applies (lib/boards/publicBoard.ts). A PRIVATE board
      // must never be listed here just because its owner opened their profile.
      boards: {
        where: { visibility: BoardVisibility.SHARED, hiddenAt: null },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { items: { where: boardVisibleLookItemWhere } } },
          items: {
            where: boardVisibleLookItemWhere,
            orderBy: { createdAt: 'desc' },
            take: BOARD_TILE_COUNT,
            select: {
              lookPost: {
                select: {
                  primaryMediaAsset: {
                    select: {
                      storageBucket: true,
                      storagePath: true,
                      thumbBucket: true,
                      thumbPath: true,
                      url: true,
                      thumbUrl: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!client || !client.isPublicProfile || !client.handle) return null
  // Narrowed once, so the board hrefs below don't each re-assert it.
  const handle = client.handle

  const viewerClientId = asTrimmedString(options?.viewerClientId)
  const isOwn = viewerClientId !== null && viewerClientId === client.id
  const following = viewerClientId
    ? await getViewerClientFollowState(prisma, {
        viewerClientId,
        followedClientId: client.id,
      })
    : false

  // "N recreated this" — one grouped read for the whole grid rather than a
  // per-card count. Same attribution rule as the creator-tier job and the pro's
  // own analytics: a non-cancelled booking citing the look as its source.
  const lookIds = client.authoredLooks.map((row) => row.id)
  const recreationsByLook = new Map<string, number>()
  if (lookIds.length > 0) {
    const grouped = await prisma.booking.groupBy({
      by: ['sourceLookPostId'],
      where: {
        sourceLookPostId: { in: lookIds },
        status: { not: BookingStatus.CANCELLED },
      },
      _count: { _all: true },
    })
    for (const row of grouped) {
      if (row.sourceLookPostId) {
        recreationsByLook.set(row.sourceLookPostId, row._count._all)
      }
    }
  }

  // Every image on the page signed in ONE round-trip per bucket rather than two
  // per asset — the grid plus four tiles per board is an N+1 waterfall otherwise.
  const boardTileAssets = client.boards.flatMap((board) =>
    board.items.map((item) => item.lookPost.primaryMediaAsset),
  )
  const rendered = await renderMediaUrlsBatch(
    [
      ...client.authoredLooks.map((row) => row.primaryMediaAsset),
      ...boardTileAssets,
    ],
    { variant: 'tile' },
  )
  const lookUrls = rendered.slice(0, client.authoredLooks.length)
  const boardUrls = rendered.slice(client.authoredLooks.length)

  const looks: PublicClientLook[] = client.authoredLooks.map((row, index) => {
    const urls = lookUrls[index]
    return {
      id: row.id,
      name: lookNameFromCaption(row.caption),
      imageUrl: urls?.renderThumbUrl ?? urls?.renderUrl ?? null,
      saveCount: row.saveCount,
      href: `/looks/${encodeURIComponent(row.id)}`,
      proName: formatProfessionalPublicDisplayName(row.professional),
      serviceName: row.service?.name ?? null,
      // ⚠️ Always "From $X", never a bare figure — see PublicClientLook.
      priceLabel: formatLookStartingPrice(row.priceStartingAt),
      recreatedCount: recreationsByLook.get(row.id) ?? 0,
      spotlighted: row.featuredAt !== null,
      recreateHref: `/looks/${encodeURIComponent(row.id)}?book=1`,
    }
  })

  let tileCursor = 0
  const boards: PublicClientBoard[] = client.boards.map((board) => {
    const tiles = board.items.map(() => boardUrls[tileCursor++])
    return {
      id: board.id,
      name: board.name,
      slug: board.slug,
      href: `/u/${encodeURIComponent(handle)}/boards/${encodeURIComponent(board.slug)}`,
      itemCount: board._count.items,
      tileImageUrls: tiles
        .map((urls) => urls?.renderThumbUrl ?? urls?.renderUrl ?? null)
        .filter((url): url is string => url !== null),
    }
  })

  return {
    handle: client.handle,
    displayName: `@${client.handle}`,
    avatarUrl: client.avatarUrl ?? null,
    bio: client.publicBio ?? null,
    standing: buildCreatorStanding(client),
    counts: {
      followers: client._count.followers,
      following: client._count.following,
      looks: looks.length,
    },
    looks,
    boards,
    viewer: { isOwn, following },
  }
}
