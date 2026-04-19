// lib/looks/types.ts
import type {
  BoardVisibility,
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  ProfessionType,
  Role,
  VerificationStatus,
} from '@prisma/client'

export type LooksCategoryDto = {
  name: string
  slug: string
}

export type LooksCountsDto = {
  likes: number
  comments: number
}

export type LooksProfessionalDto = {
  id: string
  businessName: string | null
  handle: string | null
  professionType: ProfessionType | null
  avatarUrl: string | null
  location: string | null
}

export type LooksFeedItemDto = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: string

  professional: LooksProfessionalDto | null

  _count: LooksCountsDto
  viewerLiked: boolean

  serviceId: string | null
  serviceName: string | null
  category: string | null
  serviceIds: string[]

  uploadedByRole: Role | null
  reviewId: string | null
  reviewHelpfulCount: number | null
  reviewRating: number | null
  reviewHeadline: string | null
}

export type LooksFeedViewerContextDto = {
  isAuthenticated: boolean
}

export type LooksFeedResponseDto = {
  items: LooksFeedItemDto[]
  nextCursor: string | null
  viewerContext?: LooksFeedViewerContextDto
}

export type LooksCommentUserDto = {
  id: string
  displayName: string
  avatarUrl: string | null
}

export type LooksCommentDto = {
  id: string
  body: string
  createdAt: string
  user: LooksCommentUserDto
}

export type LooksRenderedMediaDto = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
}

export type LooksPortfolioTileDto = {
  id: string
  caption: string | null
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  src: string
  serviceIds: string[]
  isVideo: boolean
  mediaType: MediaType
}

export type LooksBoardPreviewPrimaryMediaDto = {
  id: string
  url: string | null
  thumbUrl: string | null
  mediaType: MediaType
}

export type LooksBoardPreviewLookPostDto = {
  id: string
  caption: string | null
  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus
  publishedAt: string | null
  primaryMedia: LooksBoardPreviewPrimaryMediaDto | null
}

export type LooksBoardPreviewItemDto = {
  id: string
  createdAt: string
  lookPostId: string
  lookPost: LooksBoardPreviewLookPostDto | null
}

export type LooksBoardPreviewDto = {
  id: string
  clientId: string
  name: string
  visibility: BoardVisibility
  createdAt: string
  updatedAt: string
  itemCount: number
  items: LooksBoardPreviewItemDto[]
}

export type LooksProProfilePreviewDto = {
  id: string
  businessName: string | null
  handle: string | null
  avatarUrl: string | null
  professionType: ProfessionType | null
  location: string | null
  verificationStatus: VerificationStatus
  isPremium: boolean
}