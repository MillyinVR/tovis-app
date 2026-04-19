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

export function buildLooksFeedOrderBy(args: {
  kind: LooksFeedKind
}):
  | Prisma.LookPostOrderByWithRelationInput
  | Prisma.LookPostOrderByWithRelationInput[] {
  if (args.kind === 'SPOTLIGHT') {
    return [
      { spotlightScore: 'desc' },
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
  categorySlug?: string | null
  following?: boolean | null
}): LooksFeedKind {
  const categorySlug = pickNonEmptyString(args.categorySlug)

  if (args.following) return 'FOLLOWING'
  if (categorySlug === LOOKS_SPOTLIGHT_SLUG) return 'SPOTLIGHT'
  return 'ALL'
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

export function buildLooksFeedCursorWhere(args: {
  kind: 'ALL' | 'FOLLOWING'
  cursor?: StandardLooksFeedCursor | null
}): Prisma.LookPostWhereInput | undefined
export function buildLooksFeedCursorWhere(args: {
  kind: 'SPOTLIGHT'
  cursor?: SpotlightLooksFeedCursor | null
}): Prisma.LookPostWhereInput | undefined
export function buildLooksFeedCursorWhere(args: {
  kind: LooksFeedKind
  cursor?:
    | StandardLooksFeedCursor
    | SpotlightLooksFeedCursor
    | null
}): Prisma.LookPostWhereInput | undefined {
  const cursor = args.cursor
  if (!cursor) return undefined

  if (args.kind === 'SPOTLIGHT') {
    if (!isSpotlightLooksFeedCursor(cursor)) {
      return undefined
    }

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

  if (!isStandardLooksFeedCursor(cursor)) {
    return undefined
  }

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

/**
 * Backward-compatible aliases for existing imports during route migration.
 * Remove these once all call sites stop using the media-rooted names.
 */
export const buildLooksMediaFeedWhere = buildLooksFeedWhere
export const buildLooksMediaFeedOrderBy = buildLooksFeedOrderBy
export const resolveLooksMediaFeedKind = resolveLooksFeedKind