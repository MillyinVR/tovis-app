// lib/looks/mappers.ts
import 'server-only'

import { MediaType } from '@prisma/client'
import type { MediaVisibility, Role } from '@prisma/client'

import { mapPairedBeforeToDto } from '@/lib/media/pairedBefore'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import {
  resolveLookPrimaryService,
  toLookPrimaryServiceSummary,
} from '@/lib/looks/serviceOwnership'
import type {
  LooksBoardDetailRow,
  LooksBoardPreviewRow,
  LooksDetailRow,
  LooksFeedRow,
} from '@/lib/looks/selects'
import type {
  LooksBoardDetailDto,
  LooksBoardPreviewDto,
  LooksBoardPreviewPrimaryMediaDto,
  LooksCommentDto,
  LooksDetailAssetDto,
  LooksDetailItemDto,
  LooksDetailReviewDto,
  LooksFeedItemDto,
  LooksPortfolioTileDto,
  LooksRenderedMediaDto,
} from '@/lib/looks/types'
import { mapLooksProProfilePreviewToDto } from '@/lib/looks/profilePreview'
import {
  EMPTY_CLIENT_LINK_VIEWER,
  professionalProfileHref,
  resolveClientProfileHref,
  type ClientLinkViewer,
} from '@/lib/profiles/profileHrefs'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import type { LooksClientAuthorDto } from '@/lib/looks/types'

// Shared resolver for the publishing-client credit on a client-authored look.
// Returns null unless the author is still public AND has a handle, so a look is
// never attributed to a client who has since gone private (the feed gate admits
// these by public status, but detail-by-id and stale rows must re-check). Only
// the PII-safe handle + avatar are surfaced — never a real name.
function mapLooksClientAuthorToDto(
  clientAuthor:
    | {
        id: string
        handle: string | null
        avatarUrl: string | null
        isPublicProfile: boolean
      }
    | null
    | undefined,
  clientLinkViewer: ClientLinkViewer,
): LooksClientAuthorDto | null {
  if (!clientAuthor || !clientAuthor.isPublicProfile || !clientAuthor.handle) {
    return null
  }
  return {
    handle: clientAuthor.handle,
    avatarUrl: clientAuthor.avatarUrl ?? null,
    // Public author always has a /u/[handle] link; for an authorized pro viewer
    // it upgrades to the pro chart (see resolveClientProfileHref).
    profileHref: resolveClientProfileHref(
      {
        clientProfileId: clientAuthor.id,
        handle: clientAuthor.handle,
        isPublicProfile: clientAuthor.isPublicProfile,
      },
      clientLinkViewer,
    ),
  }
}

type MediaCommentUserShape = {
  id: string
  clientProfile: {
    id: string
    firstName: string
    lastName: string
    avatarUrl: string | null
    handle: string | null
    isPublicProfile: boolean
  } | null
  professionalProfile: {
    id: string
    businessName: string | null
    firstName: string | null
    lastName: string | null
    avatarUrl: string | null
  } | null
}

type MediaCommentRowShape = {
  id: string
  body: string
  createdAt: Date
  userId: string
  parentCommentId: string | null
  likeCount: number
  replyCount: number
  user: MediaCommentUserShape
  // Per-viewer like presence: the route selects the viewer's own like (if any)
  // via a filtered `likes` relation, so a non-empty array means "viewer liked".
  likes?: Array<{ id: string }>
}

export type LooksCommentViewerContext = {
  viewerUserId: string | null
  viewerIsAdmin: boolean
  // Lets a comment author's name/avatar upgrade to the pro chart link when the
  // viewer is a pro who can open that client. Omitted → public links only.
  clientLinkViewer?: ClientLinkViewer
}

type StoredMediaShape = {
  id: string
  url: string | null
  thumbUrl: string | null
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: Date
}

type FeedPrimaryMediaShape = StoredMediaShape & {
  uploadedByRole?: Role | null
  reviewId?: string | null
  review?: {
    helpfulCount: number
    rating: number
    headline: string | null
  } | null
}

type RenderableStoredMedia<T extends StoredMediaShape> = T & {
  renderUrl: string
  renderThumbUrl: string | null
}

type LooksDetailAssetRow = LooksDetailRow['assets'][number]

export type LooksRenderableDetailMedia = Omit<
  LooksDetailRow,
  'primaryMediaAsset' | 'assets'
> & {
  primaryMediaAsset: RenderableStoredMedia<LooksDetailRow['primaryMediaAsset']>
  assets: Array<
    Omit<LooksDetailAssetRow, 'mediaAsset'> & {
      mediaAsset: RenderableStoredMedia<LooksDetailAssetRow['mediaAsset']>
    }
  >
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

// LookPost.priceStartingAt is a nullable Prisma.Decimal; convert to a finite
// number for the client DTO (null when unset or non-finite).
function toFinitePrice(value: { toNumber: () => number } | null): number | null {
  if (value == null) return null
  const n = value.toNumber()
  return Number.isFinite(n) ? n : null
}

function hasStoragePointers(input: {
  storageBucket: string | null
  storagePath: string | null
}): input is {
  storageBucket: string
  storagePath: string
} {
  return Boolean(input.storageBucket && input.storagePath)
}

function pickMediaServiceTagIds(
  services:
    | Array<{
        serviceId?: string
        service?: {
          id: string
        } | null
      }>
    | null
    | undefined,
): string[] {
  const ids = new Set<string>()

  for (const serviceTag of services ?? []) {
    const explicitId = pickString(serviceTag.serviceId)
    if (explicitId) {
      ids.add(explicitId)
      continue
    }

    const nestedId = pickString(serviceTag.service?.id)
    if (nestedId) {
      ids.add(nestedId)
    }
  }

  return [...ids]
}

function normalizeCommentUser(
  user: MediaCommentUserShape,
  clientLinkViewer: ClientLinkViewer,
): {
  id: string
  displayName: string
  avatarUrl: string | null
  profileHref: string | null
} {
  const clientFirst = user.clientProfile?.firstName?.trim() ?? ''
  const clientLast = user.clientProfile?.lastName?.trim() ?? ''
  const clientFullName = [clientFirst, clientLast].filter(Boolean).join(' ')
  // Pros resolve through the canonical helper (businessName → real name → null),
  // so a pro without a business name shows their real name instead of falling to
  // the generic "User" placeholder. Honors the display-name preference once added.
  const professionalName = pickProfessionalPublicDisplayName(
    user.professionalProfile,
  )

  return {
    id: user.id,
    displayName: clientFullName || professionalName || 'User',
    avatarUrl:
      user.clientProfile?.avatarUrl ??
      user.professionalProfile?.avatarUrl ??
      null,
    profileHref: resolveCommentUserProfileHref(user, clientLinkViewer, {
      clientNameShown: Boolean(clientFullName),
    }),
  }
}

// Links a comment author to a profile, matching whichever identity is displayed:
// a client shown by name resolves through the shared client-link rule (pro chart
// when the viewer can open them, else /u/[handle]); a pro links to their
// /professionals/[id] page. Returns null when no profile is addressable.
function resolveCommentUserProfileHref(
  user: MediaCommentUserShape,
  clientLinkViewer: ClientLinkViewer,
  { clientNameShown }: { clientNameShown: boolean },
): string | null {
  if (clientNameShown) {
    return user.clientProfile
      ? resolveClientProfileHref(
          {
            clientProfileId: user.clientProfile.id,
            handle: user.clientProfile.handle,
            isPublicProfile: user.clientProfile.isPublicProfile,
          },
          clientLinkViewer,
        )
      : null
  }

  if (user.professionalProfile) {
    return professionalProfileHref(user.professionalProfile.id)
  }

  return null
}

async function renderAssetUrls(input: {
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}): Promise<{
  url: string | null
  thumbUrl: string | null
}> {
  let renderUrl = pickString(input.url)
  let renderThumbUrl = pickString(input.thumbUrl)

  if ((!renderUrl || !renderThumbUrl) && hasStoragePointers(input)) {
    const rendered = await renderMediaUrls({
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      thumbBucket: input.thumbBucket ?? null,
      thumbPath: input.thumbPath ?? null,
      url: input.url ?? null,
      thumbUrl: input.thumbUrl ?? null,
    })

    renderUrl = pickString(rendered.renderUrl) ?? renderUrl
    renderThumbUrl = pickString(rendered.renderThumbUrl) ?? renderThumbUrl
  }

  return {
    url: renderUrl,
    thumbUrl: renderThumbUrl,
  }
}

async function mapStoredMediaToRenderable<T extends StoredMediaShape>(
  item: T,
): Promise<RenderableStoredMedia<T> | null> {
  const rendered = await renderAssetUrls({
    storageBucket: item.storageBucket,
    storagePath: item.storagePath,
    thumbBucket: item.thumbBucket,
    thumbPath: item.thumbPath,
    url: item.url,
    thumbUrl: item.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    ...item,
    renderUrl: rendered.url,
    renderThumbUrl: rendered.thumbUrl,
  }
}

async function mapStoredMediaToPreviewDto(
  item: StoredMediaShape,
): Promise<LooksBoardPreviewPrimaryMediaDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: item.storageBucket,
    storagePath: item.storagePath,
    thumbBucket: item.thumbBucket,
    thumbPath: item.thumbPath,
    url: item.url,
    thumbUrl: item.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    id: item.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: item.mediaType,
  }
}

export async function mapLooksFeedMediaToDto(args: {
  item: LooksFeedRow
  viewerLiked: boolean
  viewerSaved: boolean
  viewerFollows: boolean
  clientLinkViewer?: ClientLinkViewer
}): Promise<LooksFeedItemDto | null> {
  const { item, viewerLiked, viewerSaved, viewerFollows } = args
  const clientLinkViewer = args.clientLinkViewer ?? EMPTY_CLIENT_LINK_VIEWER
  const primaryMedia: FeedPrimaryMediaShape = item.primaryMediaAsset

  const rendered = await renderAssetUrls({
    storageBucket: primaryMedia.storageBucket,
    storagePath: primaryMedia.storagePath,
    thumbBucket: primaryMedia.thumbBucket,
    thumbPath: primaryMedia.thumbPath,
    url: primaryMedia.url,
    thumbUrl: primaryMedia.thumbUrl,
  })

  if (!rendered.url) return null

  const resolvedPrimaryService = resolveLookPrimaryService({
    serviceId: item.serviceId,
    service: item.service,
  })
  const primaryService = toLookPrimaryServiceSummary(resolvedPrimaryService)

  return {
    id: item.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: primaryMedia.mediaType,
    caption: item.caption ?? primaryMedia.caption ?? null,
    createdAt: (item.publishedAt ?? item.createdAt).toISOString(),

    professional: item.professional
      ? {
          id: item.professional.id,
          businessName: item.professional.businessName ?? null,
          firstName: item.professional.firstName ?? null,
          lastName: item.professional.lastName ?? null,
          handle: item.professional.handle ?? null,
          nameDisplay: item.professional.nameDisplay ?? null,
          professionType: item.professional.professionType ?? null,
          avatarUrl: item.professional.avatarUrl ?? null,
          location: item.professional.location ?? null,
          followerCount: item.professional._count?.followers ?? 0,
        }
      : null,
    clientAuthor: mapLooksClientAuthorToDto(item.clientAuthor, clientLinkViewer),

    _count: {
      likes: item.likeCount,
      comments: item.commentCount,
    },
    viewerLiked,
    viewerSaved,
    viewerFollows,

    serviceId: primaryService?.id ?? null,
    serviceName: primaryService?.name ?? null,
    category: primaryService?.categoryName ?? null,
    serviceIds: resolvedPrimaryService.serviceIds,

    priceStartingAt: toFinitePrice(item.priceStartingAt),

    uploadedByRole: primaryMedia.uploadedByRole ?? null,
    reviewId: primaryMedia.reviewId ?? null,
    reviewHelpfulCount: primaryMedia.review?.helpfulCount ?? null,
    reviewRating: primaryMedia.review?.rating ?? null,
    reviewHeadline: primaryMedia.review?.headline ?? null,
  }
}

export function mapLooksCommentToDto(
  comment: MediaCommentRowShape,
  viewer: LooksCommentViewerContext,
): LooksCommentDto {
  const isAuthor =
    viewer.viewerUserId !== null && viewer.viewerUserId === comment.userId

  return {
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    user: normalizeCommentUser(
      comment.user,
      viewer.clientLinkViewer ?? EMPTY_CLIENT_LINK_VIEWER,
    ),
    parentCommentId: comment.parentCommentId,
    likeCount: comment.likeCount,
    replyCount: comment.replyCount,
    viewerLiked: (comment.likes?.length ?? 0) > 0,
    viewerCanDelete: isAuthor || viewer.viewerIsAdmin,
  }
}

export async function mapReviewMediaAssetToDto(input: {
  id: string
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}): Promise<LooksRenderedMediaDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    thumbBucket: input.thumbBucket,
    thumbPath: input.thumbPath,
    url: input.url,
    thumbUrl: input.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    id: input.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: input.mediaType,
    isFeaturedInPortfolio: input.isFeaturedInPortfolio,
  }
}

export async function mapPortfolioTileToDto(input: {
  id: string
  caption: string | null
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  mediaType: MediaType
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
  services?: Array<{
    serviceId?: string
    service?: {
      id: string
    } | null
  }> | null
  // Opt-in before/after pairing. Only the surfaces that select it (e.g. the pro
  // portfolio management grid) pass a value; elsewhere it's absent → no slider.
  beforeAsset?: {
    id: string
    mediaType: MediaType
    storageBucket: string
    storagePath: string
    thumbBucket: string | null
    thumbPath: string | null
    url: string | null
    thumbUrl: string | null
  } | null
}): Promise<LooksPortfolioTileDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    thumbBucket: input.thumbBucket,
    thumbPath: input.thumbPath,
    url: input.url,
    thumbUrl: input.thumbUrl,
  })

  const src = rendered.thumbUrl ?? rendered.url
  if (!src) return null

  // Only an image "after" carries a pairing (parity with the public mapper).
  const before =
    input.mediaType === MediaType.IMAGE
      ? await mapPairedBeforeToDto(input.beforeAsset ?? null)
      : null

  return {
    id: input.id,
    caption: input.caption ?? null,
    visibility: input.visibility,
    isEligibleForLooks: input.isEligibleForLooks,
    isFeaturedInPortfolio: input.isFeaturedInPortfolio,
    src,
    serviceIds: pickMediaServiceTagIds(input.services),
    isVideo: input.mediaType === MediaType.VIDEO,
    mediaType: input.mediaType,
    before,
  }
}

export async function mapLooksDetailMediaToRenderable(
  item: LooksDetailRow,
): Promise<LooksRenderableDetailMedia | null> {
  const primaryMediaAsset = await mapStoredMediaToRenderable(
    item.primaryMediaAsset,
  )

  if (!primaryMediaAsset) return null

  const assets = await Promise.all(
    item.assets.map(async (asset) => {
      const mediaAsset = await mapStoredMediaToRenderable(asset.mediaAsset)
      if (!mediaAsset) return null

      return {
        ...asset,
        mediaAsset,
      }
    }),
  )

  return {
    ...item,
    primaryMediaAsset,
    assets: assets.filter(isNonNull),
  }
}

function mapLooksDetailReviewToDto(input: {
  id: string
  rating: number
  headline: string | null
  helpfulCount: number
} | null): LooksDetailReviewDto | null {
  if (!input) return null

  return {
    id: input.id,
    rating: input.rating,
    headline: input.headline ?? null,
    helpfulCount: input.helpfulCount,
  }
}

function mapRenderableLooksDetailMediaToDto(input: {
  id: string
  renderUrl: string
  renderThumbUrl: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: Date
  review: {
    id: string
    rating: number
    headline: string | null
    helpfulCount: number
    body: string | null
  } | null
}) {
  return {
    id: input.id,
    url: input.renderUrl,
    thumbUrl: input.renderThumbUrl,
    mediaType: input.mediaType,
    caption: input.caption ?? null,
    createdAt: input.createdAt.toISOString(),
    review: mapLooksDetailReviewToDto(input.review),
  }
}

export function mapLooksDetailToDto(args: {
  item: LooksRenderableDetailMedia
  viewerContext: {
    isAuthenticated: boolean
    viewerLiked: boolean
    canComment: boolean
    canSave: boolean
    isOwner: boolean
    canModerate: boolean
  }
  clientLinkViewer?: ClientLinkViewer
}): LooksDetailItemDto {
  const { item, viewerContext } = args
  const clientLinkViewer = args.clientLinkViewer ?? EMPTY_CLIENT_LINK_VIEWER

  const resolvedPrimaryService = resolveLookPrimaryService({
    serviceId: item.serviceId,
    service: item.service,
  })
  const primaryService = resolvedPrimaryService.primaryService

  return {
    id: item.id,
    caption: item.caption ?? item.primaryMediaAsset.caption ?? null,
    status: item.status,
    visibility: item.visibility,
    moderationStatus: item.moderationStatus,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),

    professional: mapLooksProProfilePreviewToDto(item.professional),
    clientAuthor: mapLooksClientAuthorToDto(item.clientAuthor, clientLinkViewer),

    service: primaryService
      ? {
          id: primaryService.id,
          name: primaryService.name,
          category: primaryService.category
            ? {
                name: primaryService.category.name,
                slug: primaryService.category.slug,
              }
            : null,
        }
      : null,

    primaryMedia: mapRenderableLooksDetailMediaToDto(item.primaryMediaAsset),

    assets: item.assets.map((asset): LooksDetailAssetDto => ({
      id: asset.id,
      sortOrder: asset.sortOrder,
      mediaAssetId: asset.mediaAssetId,
      media: mapRenderableLooksDetailMediaToDto(asset.mediaAsset),
    })),

    _count: {
      likes: item.likeCount,
      comments: item.commentCount,
      saves: item.saveCount,
      shares: item.shareCount,
    },

    viewerContext: {
      isAuthenticated: viewerContext.isAuthenticated,
      viewerLiked: viewerContext.viewerLiked,
      canComment: viewerContext.canComment,
      canSave: viewerContext.canSave,
      isOwner: viewerContext.isOwner,
    },

    ...(viewerContext.canModerate
      ? {
          admin: {
            canModerate: true,
            archivedAt: item.archivedAt?.toISOString() ?? null,
            removedAt: item.removedAt?.toISOString() ?? null,
            primaryMediaAssetId: item.primaryMediaAssetId,
            primaryMedia: {
              visibility: item.primaryMediaAsset.visibility,
              isEligibleForLooks: item.primaryMediaAsset.isEligibleForLooks,
              isFeaturedInPortfolio:
                item.primaryMediaAsset.isFeaturedInPortfolio,
              reviewBody: item.primaryMediaAsset.review?.body ?? null,
            },
          },
        }
      : {}),
  }
}

export async function mapLooksBoardPreviewToDto(
  board: LooksBoardPreviewRow,
): Promise<LooksBoardPreviewDto> {
  const items = await Promise.all(
    board.items.map(async (item) => {
      const lookPost = item.lookPost

      if (!lookPost) {
        return {
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          lookPostId: item.lookPostId,
          lookPost: null,
        }
      }

      const primaryMedia = await mapStoredMediaToPreviewDto(
        lookPost.primaryMediaAsset,
      )

      return {
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lookPostId: item.lookPostId,
        lookPost: {
          id: lookPost.id,
          caption: lookPost.caption ?? null,
          status: lookPost.status,
          visibility: lookPost.visibility,
          moderationStatus: lookPost.moderationStatus,
          publishedAt: lookPost.publishedAt?.toISOString() ?? null,
          primaryMedia,
        },
      }
    }),
  )

  return {
    id: board.id,
    clientId: board.clientId,
    name: board.name,
    visibility: board.visibility,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    itemCount: board._count.items,
    items,
  }
}

export async function mapLooksBoardDetailToDto(
  board: LooksBoardDetailRow,
): Promise<LooksBoardDetailDto> {
  const items = await Promise.all(
    board.items.map(async (item) => {
      const lookPost = item.lookPost

      if (!lookPost) {
        return {
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          lookPostId: item.lookPostId,
          lookPost: null,
        }
      }

      const primaryMedia = await mapStoredMediaToPreviewDto(
        lookPost.primaryMediaAsset,
      )

      return {
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lookPostId: item.lookPostId,
        lookPost: {
          id: lookPost.id,
          caption: lookPost.caption ?? null,
          status: lookPost.status,
          visibility: lookPost.visibility,
          moderationStatus: lookPost.moderationStatus,
          publishedAt: lookPost.publishedAt?.toISOString() ?? null,
          primaryMedia,
        },
      }
    }),
  )

  return {
    id: board.id,
    clientId: board.clientId,
    name: board.name,
    visibility: board.visibility,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    itemCount: board._count.items,
    items,
  }
}