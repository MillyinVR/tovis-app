// lib/creator/followSuggestions.ts
//
// "Creators to follow" — the light follow-suggestions payoff for the client→client
// graph (social-first D3). Ranks the client authors whose looks the viewer has
// liked, most-liked first, excluding the viewer and anyone they already follow.
import { Prisma, PrismaClient } from '@prisma/client'

import { asTrimmedString } from '@/lib/guards'
import { listFollowedClientIds } from '@/lib/follows/clientFollows'

type SuggestionsDb = PrismaClient | Prisma.TransactionClient

const DEFAULT_LIMIT = 8
const LIKE_SCAN_LIMIT = 200

export type ClientFollowSuggestion = {
  clientId: string
  handle: string
  avatarUrl: string | null
  likedLookCount: number
}

// The minimal author shape a liked-look row carries; both real Prisma rows and
// plain test stubs satisfy it structurally (no type escape needed).
export type SuggestionLikedLookRow = {
  lookPost: {
    clientAuthor: {
      id: string
      handle: string | null
      isPublicProfile: boolean
      avatarUrl: string | null
    } | null
  }
}

/**
 * Pure ranker: tallies public client authors across the viewer's liked looks,
 * drops the viewer + already-followed, and returns the top `limit` by like
 * volume (ties broken by handle for determinism).
 */
export function rankFollowSuggestions(
  rows: readonly SuggestionLikedLookRow[],
  args: {
    excludeClientIds: Iterable<string>
    limit?: number
  },
): ClientFollowSuggestion[] {
  const exclude = new Set(args.excludeClientIds)
  const limit = args.limit ?? DEFAULT_LIMIT

  const tally = new Map<string, ClientFollowSuggestion>()

  for (const row of rows) {
    const author = row.lookPost.clientAuthor
    if (!author || !author.handle || !author.isPublicProfile) continue
    if (exclude.has(author.id)) continue

    const existing = tally.get(author.id)
    if (existing) {
      existing.likedLookCount += 1
      continue
    }

    tally.set(author.id, {
      clientId: author.id,
      handle: author.handle,
      avatarUrl: author.avatarUrl ?? null,
      likedLookCount: 1,
    })
  }

  return Array.from(tally.values())
    .sort((a, b) =>
      b.likedLookCount !== a.likedLookCount
        ? b.likedLookCount - a.likedLookCount
        : a.handle.localeCompare(b.handle),
    )
    .slice(0, Math.max(limit, 0))
}

/**
 * Loads follow suggestions for a signed-in client. Returns [] for a guest, a
 * non-client, or when nothing qualifies. Client avatar URLs are already
 * render-ready (the public profile loader uses them as-is).
 */
export async function loadClientFollowSuggestions(
  db: SuggestionsDb,
  args: {
    viewerUserId: string
    viewerClientId: string | null | undefined
    limit?: number
  },
): Promise<ClientFollowSuggestion[]> {
  const viewerUserId = asTrimmedString(args.viewerUserId)
  const viewerClientId = asTrimmedString(args.viewerClientId)
  if (!viewerUserId || !viewerClientId) return []

  const [rows, followedClientIds] = await Promise.all([
    db.lookLike.findMany({
      where: {
        userId: viewerUserId,
        lookPost: { clientAuthorId: { not: null } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIKE_SCAN_LIMIT,
      select: {
        lookPost: {
          select: {
            clientAuthor: {
              select: {
                id: true,
                handle: true,
                isPublicProfile: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    }),
    listFollowedClientIds(db, viewerClientId),
  ])

  return rankFollowSuggestions(rows, {
    excludeClientIds: [viewerClientId, ...followedClientIds],
    limit: args.limit,
  })
}
