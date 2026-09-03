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

// ── Client aftercare read (GET /api/v1/client/bookings/[id]/aftercare) ────────
export type {
  ClientAftercareSummaryDTO,
  ClientAftercareDetailDTO,
  ClientAftercareRecommendedProductDTO,
  ClientAftercareCheckoutProductDTO,
  ClientAftercareRebookDTO,
  ClientAftercareNextBookingDTO,
  ClientAftercareExistingReviewDTO,
  ClientAftercareReviewMediaDTO,
} from '@/lib/dto/clientAftercare'

// ── Client aftercare inbox list (GET /api/v1/client/aftercare) ────────────────
export type {
  ClientAftercareInboxItemDTO,
  ClientAftercareInboxDTO,
} from '@/lib/dto/clientAftercareInbox'

// ── Pro Overview / performance dashboard (GET /api/v1/pro/overview) ───────────
export type {
  ProOverviewTrendTone,
  ProOverviewMonthNavItem,
  ProOverviewMetricItem,
  ProOverviewTopServiceItem,
  ProOverviewPageData,
} from '@/lib/analytics/proMonthlyAnalytics'

// ── Pro visibility / transparency (GET /api/v1/pro/visibility) ────────────────
export type {
  ProVisibilityLeverKey,
  ProVisibilityStatus,
  ProVisibilityActionDTO,
  ProVisibilityLeverDTO,
  ProVisibilityLookCountsDTO,
  ProVisibilityHealthDTO,
} from '@/lib/pro/visibilityHealth'

// ── Pro Finance & Tax tab (GET /api/v1/pro/finance) — superset of Overview ────
export type {
  ProFinanceCardTone,
  ProFinanceSummaryCard,
  ProFinanceIncomeBreakdownItem,
  ProFinanceQuarterlyReminder,
  ProFinanceExpenseItem,
  ProFinanceCategoryInfo,
  ProFinanceBlock,
  ProFinancePageData,
} from '@/lib/finance/proFinanceSummary'

export type { ProReceiptInboxItem } from '@/lib/finance/receiptInbox'

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
  ProManagedMediaItemDTO,
  ProManagedMediaListResponseDTO,
  ProBookingMediaItemDTO,
  ProBookingMediaListResponseDTO,
  ProBookingMediaCreateResponseDTO,
  ClientReviewMediaAssetSummaryDTO,
  ClientReviewMediaCreatedDTO,
  ClientReviewMediaReviewDTO,
  ClientReviewMediaCreateResponseDTO,
} from '@/lib/dto/mediaAttach'

// ── Pro practice library (the standalone, out-of-session camera) ────────────
//    GET/POST /api/v1/pro/practice, DELETE + attach on /api/v1/pro/practice/[id]
export type {
  ProPracticeShotDTO,
  ProPracticeCreateResponseDTO,
  ProPracticeListResponseDTO,
  ProPracticeAttachTarget,
  ProPracticeAttachResponseDTO,
} from '@/lib/dto/proPractice'

// `lookPublication` on the pro/media response — already a JSON-safe DTO.
export type { ProLookPublicationResultDto } from '@/lib/looks/publication/contracts'

// ── Pro migration wizard (GET /api/v1/pro/migrate/summary) ───────────────────
export type {
  ProMigrationRaiseDTO,
  ProMigrationSummaryDTO,
  ProMigrationSummaryResponseDTO,
} from '@/lib/dto/proMigration'

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
  AuthSessionHandoffResponseDTO,
  AuthPhoneLoginSendResponseDTO,
  AuthPhoneVerifyResponseDTO,
  AuthEmailVerifyResponseDTO,
  AuthEmailSignInRequestResponseDTO,
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

// ── Support ticket create (POST /api/v1/support/tickets) ─────────────────────
export type { SupportTicketDTO } from '@/lib/dto/supportTicket'

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

// ── Client activity feed (GET /api/v1/client/activity) ──────────────────────
// The engagement surface behind the Me-header bell; `markReadEventKeys` is the
// allowlist a client hands back to POST /api/v1/client/notifications/read.
export type { ClientActivityFeedDTO } from '@/lib/dto/clientActivity'

// The feed's presentation items are already JSON-safe (createdAt → an ISO
// `timestamp` string), so the builder's own types are the wire contract.
export type {
  ActivityFollowBack,
  ActivityIconKind,
  ClientActivityItem,
} from '@/lib/notifications/activityFeed'

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

// ── Client invite link (GET /api/v1/client/referrals/invite-link) ────────────
export type { ClientInviteLinkResponseDTO } from '@/lib/dto/clientInviteLink'

// ── Public claim read (GET /api/v1/public/claim/[token]) ─────────────────────
export type {
  ClaimPublicViewState,
  ClaimPublicBookingDTO,
  ClaimPublicViewResponseDTO,
} from '@/lib/dto/claimPublic'

// ── Client card-on-file (Phase 2 no-show protection) ─────────────────────────
export type {
  ClientPaymentMethodDTO,
  ClientSetupIntentResponseDTO,
  ClientPaymentMethodsListResponseDTO,
  ClientPaymentMethodConfirmRequestDTO,
  ClientPaymentMethodConfirmResponseDTO,
  ClientPaymentMethodDeleteResponseDTO,
} from '@/lib/dto/clientPaymentMethods'

// ── Pro no-show / late-cancel fee settings (Phase 2 no-show protection) ───────
export type {
  ProNoShowSettingsDTO,
  ProNoShowSettingsResponseDTO,
  ProNoShowSettingsUpdateRequestDTO,
} from '@/lib/dto/noShowSettings'

// ── Flag-held pro features that are live (GET /api/v1/pro/capabilities) ──────
export type {
  ProCapabilitiesDTO,
  ProCapabilitiesResponseDTO,
} from '@/lib/dto/proCapabilities'

// ── Pro appointment-reminder cadence (Phase 2.3 configurable reminders) ───────
export type {
  ProReminderSettingsDTO,
  ProReminderSettingsResponseDTO,
  ProReminderSettingsUpdateRequestDTO,
  ReminderLeadDTO,
  ReminderLeadInputDTO,
  ReminderLeadUnit,
  ReminderPresetDTO,
} from '@/lib/dto/reminderSettings'

// ── Pro AI-camera monthly image usage (GET /api/v1/pro/camera/usage) ──────────
export type { ProCameraUsage } from '@/lib/pro/cameraQuota'

// ── The pro's ONE media library (GET /api/v1/pro/portfolio) ──────────────────
// Whose top zone IS the public portfolio. Shares `buildProPortfolioModel` with
// the web RSC page, so native and web resolve zones, holds and counts through
// the same code.
export type {
  ProPortfolioConsentHold,
  ProPortfolioCounts,
  ProPortfolioEngagement,
  ProPortfolioFilter,
  ProPortfolioFilterKey,
  ProPortfolioGroup,
  ProPortfolioLead,
  ProPortfolioMark,
  ProPortfolioNudgeBlock,
  ProPortfolioPageModel,
  ProPortfolioRoutes,
  ProPortfolioTile,
  ProPortfolioZone,
} from '@/app/pro/portfolio/_data/proPortfolioTypes'

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

// ── Public board (GET /api/v1/u/[handle]/boards/[slug]) ──────────────────────
export type { PublicBoardLook, PublicBoardData } from '@/lib/boards/publicBoard'

// ── Public pro profile (GET /api/v1/professionals/[id]) ──────────────────────
export type { ProPublicProfileDto } from '@/app/professionals/[id]/_data/loadProPublicProfile'

export type {
  PublicProfileHeaderDto,
  PublicOfferingDto,
  PublicPortfolioTileDto,
  PublicPortfolioTileEngagement,
  PublicProfileSignatureDto,
  PublicReviewMediaDto,
  PublicReviewDto,
  PublicReviewProReplyDto,
  PublicProfileStatsDto,
} from '@/lib/profiles/publicProfileMappers'

export type {
  ProProfileChipDto,
  ProProfileSignalsDto,
} from '@/lib/profiles/proProfileSignals'

// ── Pro review reply (PUT/DELETE /api/v1/pro/reviews/[id]/reply) ─────────────
export type {
  ProReviewReplyDTO,
  ProReviewReplyUpsertResponseDTO,
  ProReviewReplyDeleteResponseDTO,
} from '@/lib/dto/proReviewReply'

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

// ── Pro occupancy overlay (GET /api/v1/pro/availability/busy-days) ───────────
export type {
  ProBusyDayDTO,
  ProAvailabilityBusyDaysOk,
} from '@/lib/dto/proAvailability'

// ── Pro working hours (GET/POST /api/v1/pro/working-hours) ───────────────────
export type {
  ProStrandedBookingDTO,
  ProStrandedBookingsDTO,
  ProWorkingHoursLocationDTO,
  ProWorkingHoursOk,
  ProWorkingHoursSaveOk,
} from '@/lib/dto/proWorkingHours'

// ── Offering add-ons (GET /api/v1/offerings/add-ons) ─────────────────────────
export type {
  OfferingAddOnItemDTO,
  OfferingAddOnsServiceDTO,
  OfferingAddOnsProfessionalDTO,
  OfferingAddOnsOfferingDTO,
  OfferingAddOnsResponseDTO,
} from '@/lib/dto/offeringAddOns'

// ── Client addresses (GET/POST /api/v1/client/addresses) ─────────────────────
export type { ClientAddressDTO } from '@/lib/dto/clientAddress'

// ── Search ───────────────────────────────────────────────────────────────────
export type {
  SearchProLocationPreviewDto,
  SearchProItemDto,
  SearchProsResponseDto,
  SearchServiceItemDto,
  SearchServicesResponseDto,
} from '@/lib/search/contracts'

// ── Pro calendar feed ─────────────────────────────────────────────────────────
// GET /api/v1/pro/calendar. The route's response is `satisfies`-checked against
// ProCalendarResponseDTO, so this barrel entry is what the iOS contract
// validator measures the device's captured payload against.
export type {
  ProCalendarServiceItemDTO,
  ProCalendarEventDetailsDTO,
  ProCalendarBookingEventDTO,
  ProCalendarWaitlistEventDTO,
  ProCalendarBlockEventDTO,
  ProCalendarHoldEventDTO,
  ProCalendarEventDTO,
  ProCalendarStatsDTO,
  ProCalendarScopeDTO,
  ProCalendarResponseDTO,
} from '@/lib/dto/proCalendar'

// ── Pro session hub ───────────────────────────────────────────────────────────
// GET /api/v1/pro/session — the device's session-start surface. Exported so the
// iOS contract validator can measure its fixture against the real shape; before
// K17-web these types were named but unpublished, so everything on this feed
// crossed to the device with no contract coverage (the K4-B / K5-B gap).
export type {
  UiSessionMode,
  UiSessionCenterAction,
  StepKey,
  SessionBooking,
  ProSessionPayload,
} from '@/lib/proSession/types'
export type { UnsignedConsentForm } from '@/lib/consentForms/requirement'

// GET /api/v1/pro/bookings/{id}/session/state — the spine the native session hub
// polls. K17-A adds the unsigned-form list here too: the footer payload above is
// keyed to whichever booking the footer is acting on, so it cannot answer for a
// hub opened from a booking detail.
export type {
  ProSessionUnsignedConsentFormDTO,
  ProSessionStateResponseDTO,
} from '@/lib/dto/proSessionState'

// ── Pro per-client booking requirements ───────────────────────────────────────
// GET/PUT/DELETE /api/v1/pro/clients/{id}/policy (K16's switches, K17-web's read
// path). All three handlers are `satisfies`-checked against the response type,
// so the read and the two writes cannot answer in different shapes.
export type {
  ProClientPolicyDTO,
  ProClientPolicyResponseDTO,
} from '@/lib/dto/proClientPolicy'

// ── Pro recurring appointments ────────────────────────────────────────────────
// POST /api/v1/pro/booking-series (K18, Phase 8). The route's payload is
// `satisfies`-checked against the response type. 🔴 `skipped` is part of the
// contract, not an error path: a series that collided with one existing
// appointment still returns 201 with the other occurrences booked.
// K19 adds the READ side (GET /api/v1/pro/booking-series/{id}) and the scoped
// cancel (POST …/{id}/cancel), whose `untouched` list is the same kind of
// first-class honesty as `skipped`.
export type {
  ProBookingSeriesOccurrenceDTO,
  ProBookingSeriesSkippedOccurrenceDTO,
  ProBookingSeriesCreateResponseDTO,
  ProBookingSeriesUntouchedReason,
  ProBookingSeriesOccurrenceDetailDTO,
  ProBookingSeriesPricingDTO,
  ProBookingSeriesDetailDTO,
  ProBookingSeriesCancelScope,
  ProBookingSeriesCancelledOccurrenceDTO,
  ProBookingSeriesUntouchedOccurrenceDTO,
  ProBookingSeriesCancelResponseDTO,
} from '@/lib/dto/proBookingSeries'

// ── Pro client technical record ───────────────────────────────────────────────
// GET /api/v1/pro/clients/{id}/technical. Undeclared since PR4, which is why
// K14's `formVersion` + `consentForms` (#809) reached the wire with no contract
// coverage at all — the generated schema had no definition to gain a field on.
export type {
  ProConsentFormVersionDTO,
  ProConsentFormOptionDTO,
  ProClientFormulaEntryDTO,
  ProClientConsentRecordDTO,
  ProClientTechnicalRecordResponseDTO,
} from '@/lib/dto/proClientTechnicalRecord'

// ── Pro bookings list ─────────────────────────────────────────────────────────
// The native pro bookings list (GET /api/v1/pro/bookings). Exported so the iOS
// contract validator can check its fixture against the real shape — until now
// `proBookingsList.json` was Swift-decoded only, which meant the K1 payment
// badge and the K5 relationship mark rode the wire with no contract coverage
// at all (K4-B / K5-B).
export type {
  BookingsListStatusFilter,
  ProBookingListItemDTO,
  ProBookingsListResponse,
} from '@/lib/pro/proBookingsList'

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
  LookBadgeKind,
  LookBadgeTone,
  LookBadgeDto,
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
  LooksShareResponseDto,
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

// ── AI Consult (client flow + dark C6 pro brief twins) ──────────────────────
export type {
  ConsultSessionDTO,
  ConsultAvailabilityDTO,
  ConsultAvailabilityResponseDTO,
  ConsultLookSessionDTO,
  ConsultLookUnavailableReasonDTO,
  ConsultLookAvailabilityDTO,
  ConsultLookAvailabilityResponseDTO,
  ConsultLookStartRequestDTO,
  ConsultLookStartResponseDTO,
  ConsultSessionLookupDTO,
  ConsultSessionLookupResponseDTO,
  ConsultAgreementVersionDTO,
  ConsultAgreementAcceptanceDTO,
  ConsultAgreementRevocationDTO,
  ConsultAgreementRequirementDTO,
  ConsultAgreementStateDTO,
  ConsultAgreementAcceptRequestDTO,
  ConsultAgreementRevokeRequestDTO,
  ConsultAgreementStateResponseDTO,
  ConsultAgreementAcceptResponseDTO,
  ConsultIntakeQuestionRequirementDTO,
  ConsultIntakeQuestionOptionDTO,
  ConsultIntakeQuestionDTO,
  ConsultIntakeQuestionPackDTO,
  ConsultIntakeAnswerMapDTO,
  ConsultIntakePrefillSourceDTO,
  ConsultIntakePrefillProvenanceDTO,
  ConsultIntakePrefillSuggestionDTO,
  ConsultIntakePrefillSignalDTO,
  ConsultIntakeRevisionDTO,
  ConsultIntakeStateDTO,
  ConsultIntakeSubmitRequestDTO,
  ConsultIntakeStateResponseDTO,
  ConsultIntakeSubmitResponseDTO,
  ConsultInspirationSourceDTO,
  ConsultInspirationQuestionKeyDTO,
  ConsultInspirationQuestionOptionDTO,
  ConsultInspirationQuestionDTO,
  ConsultInspirationAnswerDTO,
  ConsultInspirationExactDetailDTO,
  ConsultInspirationPossibleInterpretationDTO,
  ConsultInspirationCatalogGuidanceDTO,
  ConsultInspirationSourceStateDTO,
  ConsultInspirationReviewDTO,
  ConsultInspirationStateDTO,
  ConsultInspirationStateResponseDTO,
  ConsultInspirationMutationResponseDTO,
  ConsultInspirationUploadDTO,
  ConsultInspirationIssueUploadResponseDTO,
  ConsultInspirationDeleteResponseDTO,
  ConsultInspirationSignedReadResponseDTO,
  ConsultCaptureShotKeyDTO,
  ConsultCaptureShotDTO,
  ConsultCaptureShotPackDTO,
  ConsultCaptureQualityReasonCodeDTO,
  ConsultCaptureSlotStateDTO,
  ConsultCaptureStateDTO,
  ConsultCaptureStateResponseDTO,
  ConsultCaptureIssueUploadRequestDTO,
  ConsultCaptureUploadDTO,
  ConsultCaptureIssueUploadResponseDTO,
  ConsultCaptureAttachRequestDTO,
  ConsultCaptureAttachResponseDTO,
  ConsultCaptureQualityRequestDTO,
  ConsultCaptureQualityResultDTO,
  ConsultCaptureQualityResponseDTO,
  ConsultCaptureDeleteResponseDTO,
  ConsultAnalysisConfidenceDTO,
  ConsultAnalysisEvidenceDTO,
  ConsultAnalysisObservationDTO,
  ConsultAnalysisSafetyCodeDTO,
  ConsultAnalysisServiceIntentDTO,
  ConsultAnalysisReferenceDTO,
  ConsultAnalysisPayloadDTO,
  ConsultAnalysisResultDTO,
  ConsultAnalysisStateDTO,
  ConsultAnalysisStartRequestDTO,
  ConsultAnalysisStateResponseDTO,
  ConsultAnalysisStartResponseDTO,
  ConsultBriefClientIntakeItemDTO,
  ConsultBriefAiObservationsDTO,
  ConsultBriefAchievabilityDirectionDTO,
  ConsultBriefRecommendationDirectionDTO,
  ConsultBriefInspirationDTO,
  ConsultBriefFeedbackRatingDTO,
  ConsultBriefFeedbackDTO,
  ConsultBookingProposalLineDTO,
  ConsultBookingProposalRefusalCodeDTO,
  ConsultBookingProposalDTO,
  ConsultBookingProposalAvailabilityDTO,
  ConsultBookingProposalResponseDTO,
  ConsultProposalReviewLineStatusDTO,
  ConsultProposalReviewLineDTO,
  ConsultProposalReviewDTO,
  ConsultProposalReviewResponseDTO,
  ConsultProposalReviewLineRequestDTO,
  ConsultProposalReviewRequestDTO,
  ConsultProposalReviewErrorCode,
  ConsultProposalReviewErrorDTO,
  ConsultProBriefDTO,
  ConsultProBriefResponseDTO,
  ConsultProBriefHistoryResponseDTO,
  ConsultBriefFeedbackRequestDTO,
  ConsultBriefFeedbackResponseDTO,
  ConsultClientResultsDTO,
  ConsultClientResultsResponseDTO,
  ConsultMeCardTeaserTapResponseDTO,
  ConsultClientResultsErrorCode,
  ConsultClientResultsErrorDTO,
  ConsultBriefErrorCode,
  ConsultBriefErrorDTO,
  ConsultAgreementErrorCode,
  ConsultAgreementErrorDTO,
} from '@/lib/dto/consult'
