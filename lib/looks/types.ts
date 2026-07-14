// lib/looks/types.ts
import type {
  BoardType,
  BoardVisibility,
  LookPostStatus,
  LookPostVisibility,
  MediaType,
  MediaVisibility,
  ModerationStatus,
  ProfessionType,
  ProNameDisplay,
  Role,
  VerificationStatus,
} from '@prisma/client'
import type { PairedBeforeDto } from '@/lib/media/pairedBefore'

export type LooksCategoryDto = {
  name: string
  slug: string
}

// A user-facing hashtag / style tag on a look (social-first D1). slug is the
// URL key for /looks/tags/[slug]; display is the first-seen human form. Only
// non-banned tags ever reach a DTO.
export type LooksTagDto = {
  slug: string
  display: string
}

export type LooksCountsDto = {
  likes: number
  comments: number
}

export type LooksProfessionalDto = {
  id: string
  businessName: string | null
  firstName: string | null
  lastName: string | null
  handle: string | null
  nameDisplay: ProNameDisplay | null
  professionType: ProfessionType | null
  avatarUrl: string | null
  location: string | null
  followerCount: number
}

// The publishing client credited on a client-authored look. PII-safe: handle
// and avatar only (the /u/[handle] public-profile contract), never a real name.
export type LooksClientAuthorDto = {
  handle: string
  avatarUrl: string | null
  // Link to the author's profile: /u/[handle], or the pro chart for an authorized
  // pro viewer (resolved server-side). Always set for a surfaced public author.
  profileHref: string | null
}

// One computed, live-data badge on a feed card (personalization spec §5).
// Always engine-selected — never pro-settable (spec §5.7.1). `label` arrives
// fully composed (brand-, viewer-, and count-aware) so clients render it
// verbatim; `tone` is a presentation hint mapping onto the canonical badge
// tone scale.
export type LookBadgeKind =
  | 'BOOKING_FAST'
  | 'LOOK_BOOKED_RECENTLY'
  | 'BOOKED_30D'
  | 'REBOOK_RATE'
  | 'NEW_TO_PLATFORM'
  | 'EVENT_COUNTDOWN'
  | 'DISTANCE'

export type LookBadgeTone = 'accent' | 'info' | 'success' | 'warn' | 'neutral'

export type LookBadgeDto = {
  kind: LookBadgeKind
  label: string
  tone: LookBadgeTone
}

export type LooksFeedItemDto = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  caption: string | null
  createdAt: string

  professional: LooksProfessionalDto | null
  clientAuthor: LooksClientAuthorDto | null

  _count: LooksCountsDto
  viewerLiked: boolean
  viewerSaved: boolean
  viewerFollows: boolean

  serviceId: string | null
  serviceName: string | null
  category: string | null
  serviceIds: string[]

  // Normalized subject focal point of the primary asset (camera C6), [0,1]
  // top-left. Cover-cropped surfaces (the full-screen feed) center on it via
  // CSS object-position; null = center (byte-identical to pre-C6).
  focalX: number | null
  focalY: number | null

  // Pro-set starting price for the look, surfaced on bookable discover tiles as
  // "from $X". Null when the look has no price tag (tiles fall back to "Book").
  priceStartingAt: number | null

  uploadedByRole: Role | null
  reviewId: string | null
  reviewHelpfulCount: number | null
  reviewRating: number | null
  reviewHeadline: string | null

  // Opt-in before/after pairing on the primary (image) asset → the feed renders
  // the reveal slider in-pager. Null when there's no pairing or it's a video.
  before: PairedBeforeDto | null

  // Non-banned user-facing tags (social-first D1) → tappable chips linking to
  // /looks/tags/[slug]. Empty when the look has no tags.
  tags: LooksTagDto[]

  // Owner-facing publication state. Present only on the pro's own listing
  // (GET /api/v1/pro/looks); public feed surfaces omit both fields.
  status?: LookPostStatus
  visibility?: LookPostVisibility

  // Computed live-data badge (spec §5), attached by GET /api/v1/looks only —
  // other DTO producers omit the field. null = no badge earned, or the
  // viewer-look pair landed in the permanent 5% measurement holdout (§9).
  badge?: LookBadgeDto | null
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
  // Normalized subject focal point (camera C6), [0,1] top-left. Null = center.
  focalX: number | null
  focalY: number | null
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
  // Denormalized, sampled view total (feed impressions + detail opens).
  views: number
}

export type LooksDetailViewerContextDto = {
  isAuthenticated: boolean
  viewerLiked: boolean
  // Whether the viewer has this look saved to any of their boards (false for
  // guests / non-client viewers) — lights up the bookmark on the action rail.
  viewerSaved: boolean
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
  clientAuthor: LooksClientAuthorDto | null
  service: LooksDetailServiceDto | null

  primaryMedia: LooksDetailMediaDto
  // Opt-in before/after pairing on the primary (image) asset → the detail page
  // renders the reveal slider. Null when there's no pairing or it's a video.
  before: PairedBeforeDto | null
  // Non-banned user-facing tags (social-first D1) → tappable chips linking to
  // /looks/tags/[slug]. Empty when the look has no tags.
  tags: LooksTagDto[]
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
  // Link to the author's public profile (/u/[handle] for clients,
  // /professionals/[id] for pros), or null when no public profile is addressable.
  profileHref: string | null
  // The commenter authored the look this comment sits on (the pro, or the
  // client author for client-shared looks) — renders the "Creator" badge.
  isLookAuthor: boolean
  // The commenter is a professional on the platform — renders the "Pro" badge.
  isPro: boolean
}

export type LooksCommentDto = {
  id: string
  body: string
  createdAt: string
  user: LooksCommentUserDto
  parentCommentId: string | null
  likeCount: number
  replyCount: number
  viewerLiked: boolean
  viewerCanDelete: boolean
}

export type LooksLikeResponseDto = {
  lookPostId: string
  liked: boolean
  likeCount: number
}

/** Response for the per-viewer "not for me" hide toggle (spec §2.2). */
export type LooksHideResponseDto = {
  lookPostId: string
  hidden: boolean
}

export type LooksShareResponseDto = {
  lookPostId: string
  shareCount: number
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

export type LooksCommentRepliesListResponseDto = {
  lookPostId: string
  parentCommentId: string
  replies: LooksCommentDto[]
  replyCount: number
}

export type LooksCommentLikeResponseDto = {
  lookPostId: string
  commentId: string
  liked: boolean
  likeCount: number
}

export type LooksCommentDeleteResponseDto = {
  lookPostId: string
  commentId: string
  deleted: true
  commentsCount: number
}

export type LooksReportStatusDto = 'accepted' | 'already_reported'

export type LooksLookReportResponseDto = {
  lookPostId: string
  status: LooksReportStatusDto
}

export type LooksCommentReportResponseDto = {
  lookPostId: string
  commentId: string
  status: LooksReportStatusDto
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
  /** Opt-in before/after pairing → render the comparison slider when present. */
  before: PairedBeforeDto | null
}

export type LooksBoardPreviewPrimaryMediaDto = {
  id: string
  url: string | null
  thumbUrl: string | null
  mediaType: MediaType
  // Normalized subject focal point (camera C6), [0,1] top-left. Null = center.
  focalX: number | null
  focalY: number | null
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
  /** What the board is for (creation-context, personalization spec §7). */
  type: BoardType
  /** Calendar date the board counts down to (`YYYY-MM-DD`), bridal/prom only. */
  eventDate: string | null
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
  /** URL-safe slug for the public /u/[handle]/boards/[slug] address. */
  slug: string
  visibility: BoardVisibility
  /** What the board is for (creation-context, personalization spec §7). */
  type: BoardType
  /** Calendar date the board counts down to (`YYYY-MM-DD`), bridal/prom only. */
  eventDate: string | null
  /**
   * Creation-question chip answers (question key → chosen option value),
   * validated against the type's question set in lib/boards/context.ts.
   * Owner-only — never exposed on the public board page.
   */
  answers: Record<string, string> | null
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
  firstName: string | null
  lastName: string | null
  handle: string | null
  nameDisplay: ProNameDisplay | null
  avatarUrl: string | null
  professionType: ProfessionType | null
  location: string | null
  verificationStatus: VerificationStatus
  isPremium: boolean
}