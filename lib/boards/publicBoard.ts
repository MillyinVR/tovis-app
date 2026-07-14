// lib/boards/publicBoard.ts
import 'server-only'

import { BoardVisibility } from '@prisma/client'

import { getViewerClientFollowState } from '@/lib/follows'
import { asTrimmedString } from '@/lib/guards'
import { normalizeHandle } from '@/lib/handles'
import { lookNameFromCaption } from '@/lib/looks/publication/clientLookService'
import { boardVisibleLookItemWhere } from '@/lib/looks/selects'
import { prisma } from '@/lib/prisma'
import { renderMediaUrls } from '@/lib/media/renderUrls'

export type PublicBoardLook = {
  id: string
  name: string
  imageUrl: string | null
  href: string
  // Normalized subject focal point (camera C6), [0,1] top-left. Null = center.
  focalX: number | null
  focalY: number | null
}

export type PublicBoardData = {
  handle: string
  /** Whether the owner's /u/[handle] profile is itself public (back-link gate). */
  ownerProfilePublic: boolean
  ownerAvatarUrl: string | null
  boardName: string
  boardSlug: string
  looks: PublicBoardLook[]
  viewer: {
    /** The signed-in client is looking at their OWN board. */
    isOwn: boolean
    /** The signed-in client follows the board owner. */
    followingOwner: boolean
  }
}

/**
 * Loads a SHARED, non-hidden board by its owner handle + slug for the public
 * board page. Returns null when the handle/slug doesn't resolve, the board
 * isn't SHARED, or an admin has hidden it — the page turns that into a 404 (a
 * private/hidden/non-existent board is indistinguishable, no enumeration).
 *
 * Deliberately decoupled from `isPublicProfile`: a client can share a single
 * board without opening their whole creator profile. Only PUBLISHED + PUBLIC +
 * APPROVED looks are surfaced (PII-safe — addressed by handle, never legal name).
 */
export async function loadPublicBoard(
  handleParam: string,
  slugParam: string,
  options?: { viewerClientId?: string | null },
): Promise<PublicBoardData | null> {
  const normalized = normalizeHandle(handleParam)
  const slug = asTrimmedString(slugParam)
  if (!normalized || !slug) return null

  const board = await prisma.board.findFirst({
    where: {
      slug,
      visibility: BoardVisibility.SHARED,
      hiddenAt: null,
      client: {
        handleNormalized: normalized,
        handle: { not: null },
      },
    },
    select: {
      name: true,
      slug: true,
      client: {
        select: {
          id: true,
          handle: true,
          avatarUrl: true,
          isPublicProfile: true,
        },
      },
      items: {
        // §19e — shared with the owner board selects so public + owner views gate
        // saved looks identically (no stale unpublished/rejected/removed looks).
        where: boardVisibleLookItemWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 60,
        select: {
          id: true,
          lookPost: {
            select: {
              id: true,
              caption: true,
              primaryMediaAsset: {
                select: {
                  storageBucket: true,
                  storagePath: true,
                  thumbBucket: true,
                  thumbPath: true,
                  url: true,
                  thumbUrl: true,
                  focalX: true,
                  focalY: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!board || !board.client.handle) return null

  const viewerClientId = asTrimmedString(options?.viewerClientId)
  const isOwn = viewerClientId !== null && viewerClientId === board.client.id
  const followingOwner =
    viewerClientId && !isOwn
      ? await getViewerClientFollowState(prisma, {
          viewerClientId,
          followedClientId: board.client.id,
        })
      : false

  const looks = await Promise.all(
    board.items.map(async (item) => {
      const lookPost = item.lookPost
      const { renderUrl, renderThumbUrl } = await renderMediaUrls(
        lookPost.primaryMediaAsset,
      )
      return {
        id: lookPost.id,
        name: lookNameFromCaption(lookPost.caption),
        imageUrl: renderThumbUrl ?? renderUrl,
        href: `/looks/${encodeURIComponent(lookPost.id)}`,
        focalX: lookPost.primaryMediaAsset.focalX ?? null,
        focalY: lookPost.primaryMediaAsset.focalY ?? null,
      }
    }),
  )

  return {
    handle: board.client.handle,
    ownerProfilePublic: board.client.isPublicProfile,
    ownerAvatarUrl: board.client.avatarUrl ?? null,
    boardName: board.name,
    boardSlug: board.slug,
    looks,
    viewer: { isOwn, followingOwner },
  }
}
