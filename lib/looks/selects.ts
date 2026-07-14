// lib/looks/selects.ts
import {
  LookPostStatus,
  LookPostVisibility,
  ModerationStatus,
  Prisma,
} from '@prisma/client'

import { pairedBeforeAssetSelect } from '@/lib/profiles/publicProfileSelects'

// §19e — a BoardItem is renderable only when its saved look is still publicly
// visible: PUBLISHED + APPROVED + PUBLIC + not removed. Owner board views
// (detail + preview) previously fetched every BoardItem and over-counted, so a
// saved look that got unpublished/rejected/removed rendered stale. This shared
// filter is applied to the `items` sub-query AND the `_count` in both owner
// selects, and reused by the public-board read (which had it inline). Keeping
// the retracted BoardItem row is intentional — if the look re-publishes it
// reappears — we just don't surface it while it isn't public.
export const boardVisibleLookItemWhere =
  Prisma.validator<Prisma.BoardItemWhereInput>()({
    lookPost: {
      status: LookPostStatus.PUBLISHED,
      visibility: LookPostVisibility.PUBLIC,
      moderationStatus: ModerationStatus.APPROVED,
      removedAt: null,
    },
  })

const looksServiceCategorySelect =
  Prisma.validator<Prisma.ServiceCategorySelect>()({
    name: true,
    slug: true,
  })

// User-facing hashtag / style tags on a look (social-first D1). Only non-banned
// tags surface, alphabetized by slug for a stable render order. Shared by the
// feed + detail selects so tag chips render identically on both surfaces.
export const looksTagListSelect = {
  where: { bannedAt: null },
  select: { slug: true, display: true },
  orderBy: { slug: 'asc' },
} satisfies Prisma.LookPost$tagsArgs

export const looksServicePreviewSelect =
  Prisma.validator<Prisma.ServiceSelect>()({
    id: true,
    name: true,
    category: {
      select: looksServiceCategorySelect,
    },
  })

export type LooksServicePreviewRow = Prisma.ServiceGetPayload<{
  select: typeof looksServicePreviewSelect
}>

export const looksProProfilePreviewSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    id: true,
    businessName: true,
    firstName: true,
    lastName: true,
    handle: true,
    nameDisplay: true,
    avatarUrl: true,
    professionType: true,
    location: true,
    verificationStatus: true,
    isPremium: true,
  })

export type LooksProProfilePreviewRow =
  Prisma.ProfessionalProfileGetPayload<{
    select: typeof looksProProfilePreviewSelect
  }>

// Client-authored looks credit the publishing client as the poster. Only the
// PII-safe public-profile fields are surfaced (handle + avatar), matching the
// /u/[handle] contract — never the client's real name. isPublicProfile is
// selected so mappers can refuse to attribute a look whose author went private.
export const looksClientAuthorPreviewSelect =
  Prisma.validator<Prisma.ClientProfileSelect>()({
    id: true,
    handle: true,
    avatarUrl: true,
    isPublicProfile: true,
  })

export type LooksClientAuthorPreviewRow =
  Prisma.ClientProfileGetPayload<{
    select: typeof looksClientAuthorPreviewSelect
  }>

// Feed cards surface a live follower count next to the Follow control, so the
// feed variant adds an index-backed `followers` count on top of the preview.
// The pro's account age (user.createdAt — server-side only, never mapped into
// a DTO) feeds the "New to {brand}" badge (spec §5.2) without a second query.
export const looksFeedProProfileSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    ...looksProProfilePreviewSelect,
    user: {
      select: {
        createdAt: true,
      },
    },
    _count: {
      select: {
        followers: true,
      },
    },
  })

const looksMediaPreviewSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    url: true,
    thumbUrl: true,
    storageBucket: true,
    storagePath: true,
    thumbBucket: true,
    thumbPath: true,
    mediaType: true,
    caption: true,
    createdAt: true,
    // Smart cover-crop focal point (camera C6) → object-position on cover-cropped
    // surfaces (feed, board tiles). Null = center.
    focalX: true,
    focalY: true,
  })

// The feed card's primary media additionally carries its opt-in before/after
// pairing so the reveal slider can render inline in the pager (parity with the
// portfolio grid + review surfaces). Board previews keep the leaner select.
const looksFeedPrimaryMediaSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    ...looksMediaPreviewSelect,
    beforeAsset: {
      select: pairedBeforeAssetSelect,
    },
  })

const looksDetailMediaAssetSelect =
  Prisma.validator<Prisma.MediaAssetSelect>()({
    id: true,
    url: true,
    thumbUrl: true,
    storageBucket: true,
    storagePath: true,
    thumbBucket: true,
    thumbPath: true,
    mediaType: true,
    caption: true,
    createdAt: true,
    // Smart cover-crop focal point (camera C6). Null = center.
    focalX: true,
    focalY: true,

    visibility: true,
    isEligibleForLooks: true,
    isFeaturedInPortfolio: true,
    reviewId: true,

    // Opt-in before/after pairing → the detail page renders the reveal slider
    // for the primary asset when present.
    beforeAsset: {
      select: pairedBeforeAssetSelect,
    },

    review: {
      select: {
        id: true,
        rating: true,
        headline: true,
        body: true,
        createdAt: true,
        helpfulCount: true,
      },
    },
  })

export const looksFeedSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    clientAuthorId: true,
    serviceId: true,

    caption: true,
    priceStartingAt: true,

    status: true,
    visibility: true,
    moderationStatus: true,

    publishedAt: true,
    createdAt: true,
    updatedAt: true,

    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,

    spotlightScore: true,
    rankScore: true,

    primaryMediaAsset: {
      select: looksFeedPrimaryMediaSelect,
    },

    professional: {
      select: looksFeedProProfileSelect,
    },

    clientAuthor: {
      select: looksClientAuthorPreviewSelect,
    },

    service: {
      select: looksServicePreviewSelect,
    },

    tags: looksTagListSelect,
  })

export type LooksFeedRow = Prisma.LookPostGetPayload<{
  select: typeof looksFeedSelect
}>

export const looksDetailSelect =
  Prisma.validator<Prisma.LookPostSelect>()({
    id: true,
    professionalId: true,
    clientAuthorId: true,
    serviceId: true,
    primaryMediaAssetId: true,

    caption: true,
    priceStartingAt: true,

    status: true,
    visibility: true,
    moderationStatus: true,

    publishedAt: true,
    archivedAt: true,
    removedAt: true,

    createdAt: true,
    updatedAt: true,

    likeCount: true,
    commentCount: true,
    saveCount: true,
    shareCount: true,
    viewCount: true,

    spotlightScore: true,
    rankScore: true,

    professional: {
      select: looksProProfilePreviewSelect,
    },

    clientAuthor: {
      select: looksClientAuthorPreviewSelect,
    },

    service: {
      select: looksServicePreviewSelect,
    },

    tags: looksTagListSelect,

    primaryMediaAsset: {
      select: looksDetailMediaAssetSelect,
    },

    assets: {
      orderBy: {
        sortOrder: 'asc',
      },
      select: {
        id: true,
        sortOrder: true,
        mediaAssetId: true,
        mediaAsset: {
          select: looksDetailMediaAssetSelect,
        },
      },
    },
  })

export type LooksDetailRow = Prisma.LookPostGetPayload<{
  select: typeof looksDetailSelect
}>

export const looksBoardPreviewSelect =
  Prisma.validator<Prisma.BoardSelect>()({
    id: true,
    clientId: true,
    name: true,
    visibility: true,
    type: true,
    eventDate: true,
    createdAt: true,
    updatedAt: true,

    _count: {
      select: {
        items: { where: boardVisibleLookItemWhere },
      },
    },

    items: {
      where: boardVisibleLookItemWhere,
      orderBy: {
        createdAt: 'desc',
      },
      take: 3,
      select: {
        id: true,
        createdAt: true,
        lookPostId: true,
        lookPost: {
          select: {
            id: true,
            caption: true,
            status: true,
            visibility: true,
            moderationStatus: true,
            publishedAt: true,
            primaryMediaAsset: {
              select: looksMediaPreviewSelect,
            },
          },
        },
      },
    },
  })

export type LooksBoardPreviewRow = Prisma.BoardGetPayload<{
  select: typeof looksBoardPreviewSelect
}>

export const looksBoardDetailSelect =
  Prisma.validator<Prisma.BoardSelect>()({
    id: true,
    clientId: true,
    name: true,
    slug: true,
    visibility: true,
    type: true,
    eventDate: true,
    answers: true,
    createdAt: true,
    updatedAt: true,

    _count: {
      select: {
        items: { where: boardVisibleLookItemWhere },
      },
    },

    items: {
      where: boardVisibleLookItemWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        lookPostId: true,
        lookPost: {
          select: {
            id: true,
            caption: true,
            status: true,
            visibility: true,
            moderationStatus: true,
            publishedAt: true,
            primaryMediaAsset: {
              select: looksMediaPreviewSelect,
            },
          },
        },
      },
    },
  })

export type LooksBoardDetailRow = Prisma.BoardGetPayload<{
  select: typeof looksBoardDetailSelect
}>