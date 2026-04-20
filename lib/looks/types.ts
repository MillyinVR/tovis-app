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

export type LooksDetailReviewDto = {
  id: string
  rating: number
  headline: string | null
  helpfulCount: number
}

export type LooksDetailMediaDto = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: string
  review: LooksDetailReviewDto | null
}

export type LooksDetailAssetDto = {
  id: string
  sortOrder: number
  mediaAssetId: string
  media: LooksDetailMediaDto
}

export type LooksDetailServiceDto = {
  id: string
  name: string
  category: LooksCategoryDto | null
}

export type LooksDetailCountsDto = LooksCountsDto & {
  saves: number
  shares: number
}

export type LooksDetailViewerContextDto = {
  isAuthenticated: boolean
  viewerLiked: boolean
  canComment: boolean
  canSave: boolean
  isOwner: boolean
}

export type LooksDetailAdminMediaDto = {
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  reviewBody: string | null
}

export type LooksDetailAdminDto = {
  canModerate: true
  archivedAt: string | null
  removedAt: string | null
  primaryMediaAssetId: string
  primaryMedia: LooksDetailAdminMediaDto
}

export type LooksDetailItemDto = {
  id: string
  caption: string | null
  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string

  professional: LooksProProfilePreviewDto
  service: LooksDetailServiceDto | null

  primaryMedia: LooksDetailMediaDto
  assets: LooksDetailAssetDto[]

  _count: LooksDetailCountsDto
  viewerContext: LooksDetailViewerContextDto

  admin?: LooksDetailAdminDto
}

export type LooksDetailResponseDto = {
  item: LooksDetailItemDto
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

export type LooksLikeResponseDto = {
  lookPostId: string
  liked: boolean
  likeCount: number
}

export type LooksCommentsListResponseDto = {
  lookPostId: string
  comments: LooksCommentDto[]
  commentsCount: number
}

export type LooksCommentCreateResponseDto = {
  lookPostId: string
  comment: LooksCommentDto
  commentsCount: number
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

export type LooksSavedBoardStateDto = {
  id: string
  name: string
  visibility: BoardVisibility
}

export type LooksSaveStateResponseDto = {
  lookPostId: string
  isSaved: boolean
  saveCount: number
  boardIds: string[]
  boards: LooksSavedBoardStateDto[]
}

export type LooksBoardDetailLookPostDto = LooksBoardPreviewLookPostDto

export type LooksBoardDetailItemDto = LooksBoardPreviewItemDto

export type LooksBoardDetailDto = {
  id: string
  clientId: string
  name: string
  visibility: BoardVisibility
  createdAt: string
  updatedAt: string
  itemCount: number
  items: LooksBoardDetailItemDto[]
}

export type LooksBoardsListResponseDto = {
  boards: LooksBoardPreviewDto[]
}

export type LooksBoardDetailResponseDto = {
  board: LooksBoardDetailDto
}

export type LooksBoardItemMutationResponseDto = {
  boardId: string
  lookPostId: string
  inBoard: boolean
  isSaved: boolean
  saveCount: number
  boardIds: string[]
  boards: LooksSavedBoardStateDto[]
}

export type LooksBoardDeleteResponseDto = {
  deleted: true
  id: string
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