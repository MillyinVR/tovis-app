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

// ── Media signing / URL resolution (GET /api/v1/media/url, POST */uploads) ───
export type {
  MediaSignedUrlDTO,
  MediaUploadInitDTO,
  MediaAdminUploadInitDTO,
  MediaAdminUploadFinalizeDTO,
} from '@/lib/dto/media'

// ── Media attach (POST /api/v1/pro/media, GET/POST pro/bookings/[id]/media, ──
//    POST client/reviews/[id]/media) — picked shapes, not raw Prisma rows.
export type {
  ProMediaServiceTagDTO,
  ProMediaCreatedDTO,
  ProMediaCreateResponseDTO,
  ProBookingMediaItemDTO,
  ProBookingMediaListResponseDTO,
  ProBookingMediaCreateResponseDTO,
  ClientReviewMediaAssetSummaryDTO,
  ClientReviewMediaCreatedDTO,
  ClientReviewMediaReviewDTO,
  ClientReviewMediaCreateResponseDTO,
} from '@/lib/dto/mediaAttach'

// `lookPublication` on the pro/media response — already a JSON-safe DTO.
export type { ProLookPublicationResultDto } from '@/lib/looks/publication/contracts'

// ── Messaging (GET/POST /api/v1/messages/*) ──────────────────────────────────
export type {
  MessageThreadClientPreviewDTO,
  MessageThreadProfessionalPreviewDTO,
  MessageThreadParticipantReadDTO,
  MessageThreadListItemDTO,
  MessagesThreadsListResponseDTO,
  MessageAttachmentDTO,
  MessageDTO,
  MessageThreadMessagesResponseDTO,
  CreatedMessageDTO,
  CreateMessageResponseDTO,
  ResolveThreadResponseDTO,
  MessagesUnreadCountResponseDTO,
} from '@/lib/dto/messaging'

// ── Auth + workspace switch (POST /api/v1/auth/*, /api/v1/workspace/switch) ──
export type {
  AuthUserDTO,
  AuthLoginResponseDTO,
  AuthRegisterResponseDTO,
  AuthRefreshResponseDTO,
  AuthPhoneLoginSendResponseDTO,
  AuthPhoneVerifyResponseDTO,
  AuthEmailVerifyResponseDTO,
  AuthResendPhoneCodeResponseDTO,
  AuthVerifyPhoneCodeResponseDTO,
  WorkspaceSwitchResponseDTO,
} from '@/lib/dto/auth'

// ── Booking holds (POST /api/v1/holds, GET/DELETE /api/v1/holds/[id]) ─────────
export type {
  BookingHoldDTO,
  BookingHoldCreateDTO,
  MutationMetaDTO,
  BookingHoldGetResponseDTO,
  BookingHoldCreateResponseDTO,
  BookingHoldDeleteResponseDTO,
} from '@/lib/dto/holds'

// ── Checkout / payment step (POST /api/v1/client/bookings/[id]/* checkout) ────
export type {
  StripeCheckoutSessionDTO,
  DepositStripeSessionResponseDTO,
  CheckoutStripeSessionResponseDTO,
  ClientCheckoutConfirmResponseDTO,
} from '@/lib/dto/checkout'

// ── Push device registration (POST/DELETE /api/v1/devices) ───────────────────
export type { DeviceTokenDTO } from '@/lib/dto/deviceToken'

// ── Manage devices / per-device revocation (GET /api/v1/devices) ─────────────
export type { UserDeviceDTO } from '@/lib/dto/device'

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

// ── Client notifications (GET /api/v1/client/notifications{,/summary}, POST ──
//    .../read) + preferences (GET/PATCH /api/v1/client/notification-preferences) ─
export type {
  ClientNotificationDTO,
  ClientNotificationFiltersDTO,
  ClientNotificationListDTO,
  ClientNotificationSummaryDTO,
  ClientNotificationsReadResponseDTO,
} from '@/lib/dto/clientNotifications'

// Preferences payload + its parts are already JSON-safe (no Decimal/Date), so
// the engine's own types serve as the wire contract directly.
export type {
  ChannelPreferenceState,
  QuietHoursState,
  NotificationPreferencesPayload,
} from '@/lib/notifications/preferenceService'

export type {
  NotificationCategoryKey,
  NotificationCategoryEventMeta,
  NotificationCategoryMeta,
} from '@/lib/notifications/preferenceCategories'

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

// ── Availability (GET /api/v1/availability/{day,bootstrap,alternates,other-pros}) ──
export type {
  AvailabilityDayOk,
  AvailabilityBootstrapOk,
  AvailabilityAlternatesOk,
  AvailabilityOtherProsRequestDTO,
  AvailabilityOtherProsOk,
} from '@/lib/dto/availability'

// ── Offering add-ons (GET /api/v1/offerings/add-ons) ─────────────────────────
export type {
  OfferingAddOnItemDTO,
  OfferingAddOnsServiceDTO,
  OfferingAddOnsProfessionalDTO,
  OfferingAddOnsOfferingDTO,
  OfferingAddOnsResponseDTO,
} from '@/lib/dto/offeringAddOns'

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
// NOTE: the internal pre-serialization types `FollowingListItem` /
// `FollowerListItem` (and their `*ListPage` containers) are deliberately NOT
// re-exported here — they embed raw `Prisma.*GetPayload` rows
// (`FollowProfessionalPreviewRow` / `FollowClientPreviewRow`), which leaked
// `DefaultSelection<Prisma.$…Payload, …>` gibberish into the generated JSON
// Schema. The wire contract is the `*Dto` variants below; they carry the
// JSON-safe `*PreviewDto` shapes instead.
export type {
  FollowPagination,
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
