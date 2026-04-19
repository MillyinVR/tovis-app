// lib/looks/feed.ts
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
} from '@prisma/client'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

export const LOOKS_SPOTLIGHT_SLUG = 'spotlight'

const QMODE: Prisma.QueryMode = 'insensitive'

export type LooksFeedKind = 'ALL' | 'SPOTLIGHT' | 'FOLLOWING'
export type LooksFeedSort = 'RECENT' | 'RANKED'

type LooksFeedOrderMode = 'RECENT' | 'RANKED' | 'SPOTLIGHT'

export type LooksMediaFeedKind = LooksFeedKind

export type BuildLooksFeedWhereArgs = {
  kind: LooksFeedKind
  categorySlug?: string | null
  q?: string | null
  followingProfessionalIds?: readonly string[] | null
}

export type BuildLooksMediaFeedWhereArgs = BuildLooksFeedWhereArgs

export type StandardLooksFeedCursor = {
  publishedAt: Date
  id: string
}

export type SpotlightLooksFeedCursor = {
  spotlightScore: number
  publishedAt: Date
  id: string
}

export type RankedLooksFeedCursor = {
  rankScore: number
  publishedAt: Date
  id: string
}

export type LooksFeedCursor =
  | StandardLooksFeedCursor
  | SpotlightLooksFeedCursor
  | RankedLooksFeedCursor

function pickNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function pickDistinctIds(
  ids: readonly string[] | null | undefined,
): string[] {
  if (!ids?.length) return []

  return Array.from(
    new Set(
      ids
        .map((id) => pickNonEmptyString(id))
        .filter((id): id is string => id !== null),
    ),
  )
}

function buildLooksVisibilityFilter(
  kind: LooksFeedKind,
): Prisma.LookPostWhereInput {
  if (kind === 'FOLLOWING') {
    return {
      visibility: {
        in: [
          LookPostVisibility.PUBLIC,
          LookPostVisibility.FOLLOWERS_ONLY,
        ],
      },
    }
  }

  return {
    visibility: LookPostVisibility.PUBLIC,
  }
}

function buildFollowingFeedFilter(
  followingProfessionalIds: readonly string[],
): Prisma.LookPostWhereInput {
  if (followingProfessionalIds.length === 0) {
    return {
      professionalId: {
        in: [],
      },
    }
  }

  return {
    professionalId: {
      in: [...followingProfessionalIds],
    },
  }
}

function buildCategoryFilter(
  categorySlug: string | null,
): Prisma.LookPostWhereInput | null {
  if (!categorySlug) return null

  return {
    service: {
      is: {
        category: {
          is: {
            slug: categorySlug,
          },
        },
      },
    },
  }
}

function buildLooksSearchFilter(q: string): Prisma.LookPostWhereInput {
  return {
    OR: [
      {
        caption: {
          contains: q,
          mode: QMODE,
        },
      },
      {
        professional: {
          is: {
            businessName: {
              contains: q,
              mode: QMODE,
            },
          },
        },
      },
      {
        professional: {
          is: {
            handle: {
              contains: q,
              mode: QMODE,
            },
          },
        },
      },
      {
        service: {
          is: {
            name: {
              contains: q,
              mode: QMODE,
            },
          },
        },
      },
      {
        service: {
          is: {
            category: {
              is: {
                name: {
                  contains: q,
                  mode: QMODE,
                },
              },
            },
          },
        },
      },
    ],
  }
}

export function buildLooksFeedWhere(
  args: BuildLooksFeedWhereArgs,
): Prisma.LookPostWhereInput {
  const categorySlug = pickNonEmptyString(args.categorySlug)
  const q = pickNonEmptyString(args.q)
  const followingProfessionalIds = pickDistinctIds(
    args.followingProfessionalIds,
  )

  const and: Prisma.LookPostWhereInput[] = [
    buildLooksVisibilityFilter(args.kind),
  ]

  const categoryFilter = buildCategoryFilter(categorySlug)
  if (categoryFilter) {
    and.push(categoryFilter)
  }

  if (args.kind === 'FOLLOWING') {
    and.push(buildFollowingFeedFilter(followingProfessionalIds))
  }

  if (q) {
    and.push(buildLooksSearchFilter(q))
  }

  return {
    status: LookPostStatus.PUBLISHED,
    moderationStatus: ModerationStatus.APPROVED,
    publishedAt: {
      not: null,
    },
    professional: {
      is: {
        verificationStatus: {
          in: [...PUBLICLY_APPROVED_PRO_STATUSES],
        },
      },
    },
    ...(and.length > 0 ? { AND: and } : {}),
  }
}

export function resolveLooksFeedOrderMode(args: {
  kind: LooksFeedKind
  sort?: LooksFeedSort | null
}): LooksFeedOrderMode {
  if (args.sort === 'RANKED') return 'RANKED'
  if (args.kind === 'SPOTLIGHT') return 'SPOTLIGHT'
  return 'RECENT'
}

export function buildLooksFeedOrderBy(args: {
  kind: LooksFeedKind
  sort?: LooksFeedSort | null
}):
  | Prisma.LookPostOrderByWithRelationInput
  | Prisma.LookPostOrderByWithRelationInput[] {
  const mode = resolveLooksFeedOrderMode(args)

  if (mode === 'SPOTLIGHT') {
    return [
      { spotlightScore: 'desc' },
      { publishedAt: 'desc' },
      { id: 'desc' },
    ]
  }

  if (mode === 'RANKED') {
    return [
      { rankScore: 'desc' },
      { publishedAt: 'desc' },
      { id: 'desc' },
    ]
  }

  return [
    { publishedAt: 'desc' },
    { id: 'desc' },
  ]
}

export function resolveLooksFeedKind(args: {
  filter?: string | null
  categorySlug?: string | null
  following?: boolean | null
}): LooksFeedKind | null {
  const filter = pickNonEmptyString(args.filter)?.toLowerCase() ?? null
  const categorySlug = pickNonEmptyString(args.categorySlug)

  if (args.following) return 'FOLLOWING'

  if (!filter) {
    if (categorySlug === LOOKS_SPOTLIGHT_SLUG) return 'SPOTLIGHT'
    return 'ALL'
  }

  if (filter === 'all') return 'ALL'
  if (filter === 'following') return 'FOLLOWING'
  if (filter === 'spotlight') return 'SPOTLIGHT'

  return null
}

function isStandardLooksFeedCursor(
  cursor:
    | StandardLooksFeedCursor
    | SpotlightLooksFeedCursor
    | null
    | undefined,
): cursor is StandardLooksFeedCursor {
  return (
    Boolean(cursor) &&
    cursor?.publishedAt instanceof Date &&
    typeof cursor.id === 'string'
  )
}

function hasSpotlightScore(
  cursor: StandardLooksFeedCursor | SpotlightLooksFeedCursor,
): cursor is SpotlightLooksFeedCursor {
  return (
    'spotlightScore' in cursor &&
    typeof cursor.spotlightScore === 'number'
  )
}

function isSpotlightLooksFeedCursor(
  cursor:
    | StandardLooksFeedCursor
    | SpotlightLooksFeedCursor
    | null
    | undefined,
): cursor is SpotlightLooksFeedCursor {
  return isStandardLooksFeedCursor(cursor) && hasSpotlightScore(cursor)
}

function hasRankScore(
  cursor:
    | StandardLooksFeedCursor
    | SpotlightLooksFeedCursor
    | RankedLooksFeedCursor,
): cursor is RankedLooksFeedCursor {
  return 'rankScore' in cursor && typeof cursor.rankScore === 'number'
}

function isRankedLooksFeedCursor(
  cursor:
    | StandardLooksFeedCursor
    | SpotlightLooksFeedCursor
    | RankedLooksFeedCursor
    | null
    | undefined,
): cursor is RankedLooksFeedCursor {
  return isStandardLooksFeedCursor(cursor) && hasRankScore(cursor)
}

export function buildLooksFeedCursorWhere(args: {
  kind: LooksFeedKind
  sort?: LooksFeedSort | null
  cursor?: LooksFeedCursor | null
}): Prisma.LookPostWhereInput | undefined {
  const cursor = args.cursor
  if (!cursor) return undefined

  const mode = resolveLooksFeedOrderMode({
    kind: args.kind,
    sort: args.sort ?? null,
  })

  if (mode === 'SPOTLIGHT') {
    if (!isSpotlightLooksFeedCursor(cursor)) return undefined

    return {
      OR: [
        {
          spotlightScore: {
            lt: cursor.spotlightScore,
          },
        },
        {
          spotlightScore: cursor.spotlightScore,
          publishedAt: {
            lt: cursor.publishedAt,
          },
        },
        {
          spotlightScore: cursor.spotlightScore,
          publishedAt: cursor.publishedAt,
          id: {
            lt: cursor.id,
          },
        },
      ],
    }
  }

  if (mode === 'RANKED') {
    if (!isRankedLooksFeedCursor(cursor)) return undefined

    return {
      OR: [
        {
          rankScore: {
            lt: cursor.rankScore,
          },
        },
        {
          rankScore: cursor.rankScore,
          publishedAt: {
            lt: cursor.publishedAt,
          },
        },
        {
          rankScore: cursor.rankScore,
          publishedAt: cursor.publishedAt,
          id: {
            lt: cursor.id,
          },
        },
      ],
    }
  }

  if (!isStandardLooksFeedCursor(cursor)) return undefined

  return {
    OR: [
      {
        publishedAt: {
          lt: cursor.publishedAt,
        },
      },
      {
        publishedAt: cursor.publishedAt,
        id: {
          lt: cursor.id,
        },
      },
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseLooksFeedSort(
  value: string | null | undefined,
): LooksFeedSort | null {
  const raw = pickNonEmptyString(value)
  if (!raw) return null

  const normalized = raw.toLowerCase()
  if (normalized === 'recent') return 'RECENT'
  if (normalized === 'ranked') return 'RANKED'

  return null
}

export function decodeLooksFeedCursor(
  raw: string | null | undefined,
): LooksFeedCursor | null {
  const token = pickNonEmptyString(raw)
  if (!token) return null

  try {
    const decoded = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    ) as unknown

    if (!isRecord(decoded)) return null
    if (typeof decoded.id !== 'string' || !decoded.id.trim()) return null
    if (typeof decoded.publishedAt !== 'string') return null

    const publishedAt = new Date(decoded.publishedAt)
    if (Number.isNaN(publishedAt.getTime())) return null

    if (typeof decoded.spotlightScore === 'number') {
      return {
        id: decoded.id,
        publishedAt,
        spotlightScore: decoded.spotlightScore,
      }
    }

    if (typeof decoded.rankScore === 'number') {
      return {
        id: decoded.id,
        publishedAt,
        rankScore: decoded.rankScore,
      }
    }

    return {
      id: decoded.id,
      publishedAt,
    }
  } catch {
    return null
  }
}

export function encodeLooksFeedCursor(args: {
  kind: LooksFeedKind
  sort?: LooksFeedSort | null
  row: {
    id: string
    publishedAt: Date | null
    spotlightScore: number
    rankScore: number
  }
}): string | null {
  if (!(args.row.publishedAt instanceof Date)) return null

  const mode = resolveLooksFeedOrderMode({
    kind: args.kind,
    sort: args.sort ?? null,
  })

  const payload: Record<string, unknown> = {
    id: args.row.id,
    publishedAt: args.row.publishedAt.toISOString(),
  }

  if (mode === 'SPOTLIGHT') {
    payload.spotlightScore = args.row.spotlightScore
  } else if (mode === 'RANKED') {
    payload.rankScore = args.row.rankScore
  }

  return Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )
}

/**
 * Backward-compatible aliases for existing imports during route migration.
 * Remove these once all call sites stop using the media-rooted names.
 */
export const buildLooksMediaFeedWhere = buildLooksFeedWhere
export const buildLooksMediaFeedOrderBy = buildLooksFeedOrderBy
export const resolveLooksMediaFeedKind = resolveLooksFeedKind