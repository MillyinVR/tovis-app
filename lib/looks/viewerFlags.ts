// lib/looks/viewerFlags.ts
import 'server-only'

import { prisma } from '@/lib/prisma'

export type LooksViewerFlags = {
  viewerLiked: boolean
  viewerSaved: boolean
  viewerFollows: boolean
}

// Minimal structural shape so this stays decoupled from the full CurrentUser.
type LooksViewerUser = {
  id: string
  clientProfile?: { id: string } | null
} | null

type LooksViewerRow = {
  id: string
  professionalId: string
}

/**
 * Resolve per-item viewer flags (liked / saved / followed) for a page of feed
 * rows in three batched queries, then return a lookup so callers don't re-derive
 * the membership checks. Shared by the looks feed route and looks search so the
 * hydration lives in exactly one place.
 *
 * - likes are keyed by the viewer's user id
 * - saves and follows require a client profile (pros/guests get `false`)
 */
export async function buildLooksViewerFlagResolver(args: {
  user: LooksViewerUser
  items: ReadonlyArray<LooksViewerRow>
}): Promise<(item: LooksViewerRow) => LooksViewerFlags> {
  const { user, items } = args
  const clientId = user?.clientProfile?.id ?? null

  let likedSet = new Set<string>()
  let savedSet = new Set<string>()
  let followedSet = new Set<string>()

  if (user && items.length > 0) {
    const lookPostIds = items.map((item) => item.id)
    const professionalIds = Array.from(
      new Set(items.map((item) => item.professionalId)),
    )

    const [likes, savedItems, follows] = await Promise.all([
      prisma.lookLike.findMany({
        where: {
          userId: user.id,
          lookPostId: { in: lookPostIds },
        },
        select: { lookPostId: true },
      }),
      clientId
        ? prisma.boardItem.findMany({
            where: {
              lookPostId: { in: lookPostIds },
              board: { clientId },
            },
            select: { lookPostId: true },
          })
        : Promise.resolve([] as Array<{ lookPostId: string }>),
      clientId
        ? prisma.proFollow.findMany({
            where: {
              clientId,
              professionalId: { in: professionalIds },
            },
            select: { professionalId: true },
          })
        : Promise.resolve([] as Array<{ professionalId: string }>),
    ])

    likedSet = new Set(likes.map((like) => like.lookPostId))
    savedSet = new Set(savedItems.map((item) => item.lookPostId))
    followedSet = new Set(follows.map((follow) => follow.professionalId))
  }

  return (item) => ({
    viewerLiked: user ? likedSet.has(item.id) : false,
    viewerSaved: clientId ? savedSet.has(item.id) : false,
    viewerFollows: clientId ? followedSet.has(item.professionalId) : false,
  })
}
