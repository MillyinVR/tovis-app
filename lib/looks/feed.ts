// lib/looks/feed.ts
import { Prisma, MediaVisibility, Role } from '@prisma/client'
import { PUBLICLY_APPROVED_PRO_STATUSES } from '@/lib/proTrustState'

export const LOOKS_SPOTLIGHT_SLUG = 'spotlight'
export const LOOKS_SPOTLIGHT_HELPFUL_THRESHOLD = 25

const QMODE: Prisma.QueryMode = 'insensitive'

export type LooksMediaFeedKind = 'ALL' | 'SPOTLIGHT' | 'FOLLOWING'

export type BuildLooksMediaFeedWhereArgs = {
  kind: LooksMediaFeedKind
  categorySlug?: string | null
  q?: string | null
  followingProfessionalIds?: readonly string[] | null
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

function buildSpotlightFeedFilters(): Prisma.MediaAssetWhereInput[] {
  return [
    { reviewId: { not: null } },
    { uploadedByRole: Role.CLIENT },
    {
      review: {
        is: {
          helpfulCount: { gte: LOOKS_SPOTLIGHT_HELPFUL_THRESHOLD },
        },
      },
    },
  ]
}

function buildDefaultLooksFeedFilters(args: {
  categorySlug: string | null
}): Prisma.MediaAssetWhereInput[] {
  const filters: Prisma.MediaAssetWhereInput[] = [
    {
      OR: [
        { isEligibleForLooks: true },
        { isFeaturedInPortfolio: true },
      ],
    },
  ]

  if (args.categorySlug) {
    filters.push({
      services: {
        some: {
          service: {
            category: {
              is: { slug: args.categorySlug },
            },
          },
        },
      },
    })
  }

  return filters
}

function buildFollowingFeedFilter(
  followingProfessionalIds: readonly string[],
): Prisma.MediaAssetWhereInput {
  return {
    professionalId: {
      in: [...followingProfessionalIds],
    },
  }
}

function buildLooksSearchFilter(q: string): Prisma.MediaAssetWhereInput {
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
          businessName: {
            contains: q,
            mode: QMODE,
          },
        },
      },
      {
        professional: {
          handle: {
            contains: q,
            mode: QMODE,
          },
        },
      },
    ],
  }
}

export function buildLooksMediaFeedWhere(
  args: BuildLooksMediaFeedWhereArgs,
): Prisma.MediaAssetWhereInput {
  const kind = args.kind
  const categorySlug = pickNonEmptyString(args.categorySlug)
  const q = pickNonEmptyString(args.q)
  const followingProfessionalIds = pickDistinctIds(
    args.followingProfessionalIds,
  )

  const and: Prisma.MediaAssetWhereInput[] = []

  if (kind === 'SPOTLIGHT') {
    and.push(...buildSpotlightFeedFilters())
  } else {
    and.push(
      ...buildDefaultLooksFeedFilters({
        categorySlug,
      }),
    )

    if (kind === 'FOLLOWING') {
      if (followingProfessionalIds.length === 0) {
        and.push({
          professionalId: {
            in: [],
          },
        })
      } else {
        and.push(buildFollowingFeedFilter(followingProfessionalIds))
      }
    }
  }

  if (q) {
    and.push(buildLooksSearchFilter(q))
  }

  return {
    visibility: MediaVisibility.PUBLIC,
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

export function buildLooksMediaFeedOrderBy(args: {
  kind: LooksMediaFeedKind
}):
  | Prisma.MediaAssetOrderByWithRelationInput
  | Prisma.MediaAssetOrderByWithRelationInput[] {
  if (args.kind === 'SPOTLIGHT') {
    return [
      { review: { helpfulCount: 'desc' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]
  }

  return [
    { createdAt: 'desc' },
    { id: 'desc' },
  ]
}

export function resolveLooksMediaFeedKind(args: {
  categorySlug?: string | null
  following?: boolean | null
}): LooksMediaFeedKind {
  const categorySlug = pickNonEmptyString(args.categorySlug)

  if (args.following) return 'FOLLOWING'
  if (categorySlug === LOOKS_SPOTLIGHT_SLUG) return 'SPOTLIGHT'
  return 'ALL'
}