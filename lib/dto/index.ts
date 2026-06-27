// lib/dto/index.ts
//
// Single barrel for the native/web JSON wire contract — every response DTO a
// client decodes, re-exported from one place. This is the source the API JSON
// Schema is generated from (`npm run gen:api-schema` → ts-json-schema-generator
// → schema/api/tovis-api.schema.json), which a native Swift/Kotlin build then
// codegens models from.
//
// SCOPE: response (output) shapes only. Deliberately EXCLUDES:
//   - raw Prisma row types (`*Row`, `*Plan`) — they carry Prisma.Decimal/Date and
//     are builder inputs, not wire shapes;
//   - request/arg types (`*Args`) — request validation is still ad-hoc per route;
//   - internal-only contracts (admin moderation, job payloads).
// Everything re-exported here must be JSON-safe (Decimal→string, Date→ISO).
//
// Keep this list in sync as DTOs are added. The house rule is "Prisma is the
// single source of truth for data shapes" — these DTOs derive from Prisma via
// the builders/mappers; this barrel only re-exports their already-serialized
// output types.

// ── Bookings ────────────────────────────────────────────────────────────────
export type {
  ClientBookingItemDTO,
  ClientBookingProductSaleDTO,
  ClientBookingConsultationDTO,
  ClientBookingTimeZoneSource,
  ClientBookingCheckoutDTO,
  ClientBookingDTO,
} from '@/lib/dto/clientBooking'

export type {
  ProBookingNewClientDTO,
  ProBookingNewOfferingDTO,
} from '@/lib/dto/proBookingNew'

// ── Push device registration (POST/DELETE /api/v1/devices) ───────────────────
export type { DeviceTokenDTO } from '@/lib/dto/deviceToken'

// ── Client home dashboard (GET /api/v1/client/home) ──────────────────────────
export type {
  ClientHomeBookingDTO,
  ClientHomeAftercareDTO,
  ClientHomeActionDTO,
  ClientHomeLastMinuteInviteDTO,
  ClientHomeWaitlistEntryDTO,
  ClientHomeFavoriteProDTO,
  ClientHomeFavoriteServiceDTO,
  ClientHomeViralLiveDTO,
  ClientHomeViralPendingDTO,
  ClientHomeDTO,
} from '@/lib/dto/clientHome'

// ── Client "Me" aggregate (GET /api/v1/me) ───────────────────────────────────
export type {
  ClientMeUserDTO,
  ClientMeProfileDTO,
  ClientMeHistoryItemDTO,
  ClientMePageDTO,
} from '@/lib/dto/clientMe'

// ── Public client profile (GET /api/v1/u/[handle]) ───────────────────────────
export type {
  PublicClientLook,
  PublicClientProfileViewer,
  PublicClientProfileData,
} from '@/app/u/[handle]/_data/loadPublicClientProfile'

// ── Public pro profile (GET /api/v1/professionals/[id]) ──────────────────────
export type { ProPublicProfileDto } from '@/app/professionals/[id]/_data/loadProPublicProfile'

export type {
  PublicProfileHeaderDto,
  PublicOfferingDto,
  PublicPortfolioTileDto,
  PublicReviewMediaDto,
  PublicReviewDto,
  PublicProfileStatsDto,
} from '@/lib/profiles/publicProfileMappers'

// ── Last-minute opening detail (GET /api/v1/offerings/[id]) ───────────────────
export type {
  OfferingDetailLoaded,
  OfferingDetailResult,
} from '@/app/(main)/offerings/[offeringId]/_data/loadOfferingDetail'

export type {
  PublicIncentiveDto,
  OpeningServiceDto,
} from '@/lib/lastMinute/openingDto'

// ── Search ───────────────────────────────────────────────────────────────────
export type {
  SearchProLocationPreviewDto,
  SearchProItemDto,
  SearchProsResponseDto,
  SearchServiceItemDto,
  SearchServicesResponseDto,
} from '@/lib/search/contracts'

// ── Pro locations ─────────────────────────────────────────────────────────────
export type {
  LocationType,
  ProLocation,
  PickedPlace,
} from '@/lib/contracts/proLocations'

// ── Follows ───────────────────────────────────────────────────────────────────
export type {
  FollowingListItem,
  FollowerListItem,
  FollowPagination,
  FollowingListPage,
  FollowersListPage,
  ProfessionalFollowState,
  ProFollowStateResponseDto,
  FollowClientPreviewDto,
  FollowerListItemDto,
  FollowersListResponseDto,
  FollowingListItemDto,
  MyFollowingListResponseDto,
  FollowErrorMeta,
} from '@/lib/follows'

// ── Looks (feed / detail / comments / boards) ────────────────────────────────
export type {
  LooksCategoryDto,
  LooksCountsDto,
  LooksProfessionalDto,
  LooksClientAuthorDto,
  LooksFeedItemDto,
  LooksFeedViewerContextDto,
  LooksFeedResponseDto,
  LooksDetailReviewDto,
  LooksDetailMediaDto,
  LooksDetailAssetDto,
  LooksDetailServiceDto,
  LooksDetailCountsDto,
  LooksDetailViewerContextDto,
  LooksDetailItemDto,
  LooksDetailResponseDto,
  LooksCommentUserDto,
  LooksCommentDto,
  LooksLikeResponseDto,
  LooksCommentsListResponseDto,
  LooksCommentCreateResponseDto,
  LooksCommentRepliesListResponseDto,
  LooksCommentLikeResponseDto,
  LooksCommentDeleteResponseDto,
  LooksReportStatusDto,
  LooksLookReportResponseDto,
  LooksCommentReportResponseDto,
  LooksRenderedMediaDto,
  LooksPortfolioTileDto,
  LooksBoardPreviewPrimaryMediaDto,
  LooksBoardPreviewLookPostDto,
  LooksBoardPreviewItemDto,
  LooksBoardPreviewDto,
  LooksSavedBoardStateDto,
  LooksSaveStateResponseDto,
  LooksBoardDetailLookPostDto,
  LooksBoardDetailItemDto,
  LooksBoardDetailDto,
  LooksBoardsListResponseDto,
  LooksBoardDetailResponseDto,
  LooksBoardItemMutationResponseDto,
  LooksBoardDeleteResponseDto,
  LooksProProfilePreviewDto,
} from '@/lib/looks/types'
