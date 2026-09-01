// lib/dto/consult.ts
//
// Wire DTO for the AI Consult Phase 0 booking-attached hair-color pilot.
// Sensitive intake content is exposed only through the consent-gated intake
// route and comes from immutable ConsultRevision rows.

import type {
  ConsultAgreementKind,
  ConsultInspirationSource,
  ConsultServiceEstimateLineSource,
  ConsultServiceEstimateRefusalCode,
  ConsultServiceEstimateStatus,
  ConsultSessionStatus,
  ServiceLocationType,
} from '@prisma/client'

// GET/POST /api/v1/client/consult — the pre-visit AI consult session.
export type ConsultSessionDTO = {
  id: string
  status: ConsultSessionStatus
  bookingId: string
  professionalId: string
  serviceCategoryId: string
  createdAt: string
}

// GET /api/v1/client/consult/availability?bookingId= — whether the AI consult
// entry surface is open for a booking the caller owns. Answers the same rule
// the web booking page uses to render its consult card (booking eligibility +
// existing-session ownership), so a native client can gate its entry point on
// the server's decision instead of shipping a copy of the gate. Hidden
// ineligibility reasons answer `available: false` with no reason — the same
// no-leak behavior as the card simply not rendering.
export type ConsultAvailabilityDTO = {
  available: boolean
  consult: ConsultSessionDTO | null
}

export type ConsultAvailabilityResponseDTO = {
  availability: ConsultAvailabilityDTO
}

// GET/POST /api/v1/client/consult/look — a consult anchored to a LOOK and a
// professional, with NO booking (Book the Look, B2). A DELIBERATELY SEPARATE
// type from ConsultSessionDTO rather than a nullable `bookingId` on it: shipped
// iOS builds decode `ConsultSession.bookingId` as a non-optional String, and
// the booking-anchored availability endpoint they read (#1016) must keep its
// exact shape. The look-anchored surfaces are new, so they get new types and
// the published schema grows by addition only.
export type ConsultLookSessionDTO = {
  id: string
  status: ConsultSessionStatus
  lookPostId: string
  professionalId: string
  serviceCategoryId: string
  createdAt: string
}

// Why a look may not be consultable, when saying so leaks nothing. A Look with
// no service linkage, or one linked outside the pilot vertical, is a refusal
// the client can be told about; the founder gate stays a silent
// `available: false` with no reason, exactly like the booking endpoint.
export type ConsultLookUnavailableReasonDTO =
  | 'LOOK_SERVICE_UNLINKED'
  | 'LOOK_VERTICAL_NOT_ENABLED'

export type ConsultLookAvailabilityDTO = {
  available: boolean
  reason: ConsultLookUnavailableReasonDTO | null
  consult: ConsultLookSessionDTO | null
}

export type ConsultLookAvailabilityResponseDTO = {
  availability: ConsultLookAvailabilityDTO
}

export type ConsultLookStartRequestDTO = {
  lookPostId: string
}

export type ConsultLookStartResponseDTO = {
  consult: ConsultLookSessionDTO
}

// Exact immutable wording currently required for one legal prerequisite.
// Production owns publication; the client contract never supplies wording.
export type ConsultAgreementVersionDTO = {
  id: string
  kind: ConsultAgreementKind
  version: number
  title: string
  body: string
  publishedAt: string
}

export type ConsultAgreementAcceptanceDTO = {
  id: string
  agreementVersionId: string
  version: number
  acceptedAt: string
}

export type ConsultAgreementRevocationDTO = {
  acceptanceId: string
  agreementVersionId: string
  version: number
  acceptedAt: string
  revokedAt: string
  reason: string
}

export type ConsultAgreementRequirementDTO = {
  kind: ConsultAgreementKind
  requiredVersion: ConsultAgreementVersionDTO
  currentAcceptance: ConsultAgreementAcceptanceDTO | null
  latestRevocation: ConsultAgreementRevocationDTO | null
}

// GET/POST /api/v1/client/consult/[id]/agreements — complete non-sensitive
// legal gate state. Consent and age attestation remain distinct array entries.
export type ConsultAgreementStateDTO = {
  consultId: string
  status: ConsultSessionStatus
  requirements: ConsultAgreementRequirementDTO[]
}

export type ConsultAgreementAcceptRequestDTO = {
  kind: ConsultAgreementKind
  agreementVersionId: string
}

export type ConsultAgreementRevokeRequestDTO = {
  acceptanceId: string
  reason: string
}

export type ConsultAgreementStateResponseDTO = {
  agreementState: ConsultAgreementStateDTO
}

export type ConsultAgreementAcceptResponseDTO =
  ConsultAgreementStateResponseDTO & {
    replayed: boolean
  }

export type ConsultIntakeQuestionRequirementDTO =
  | 'REQUIRED'
  | 'CONDITIONAL'
  | 'SKIPPABLE'

export type ConsultIntakeQuestionOptionDTO = {
  value: string
  label: string
}

export type ConsultIntakeQuestionDTO = {
  key: string
  label: string
  helpText: string | null
  kind: 'SINGLE_SELECT'
  requirement: ConsultIntakeQuestionRequirementDTO
  options: ConsultIntakeQuestionOptionDTO[]
}

export type ConsultIntakeQuestionPackDTO = {
  id: 'hair-color'
  categorySlug: 'hair-color'
  version: number
  schemaVersion: number
  questions: ConsultIntakeQuestionDTO[]
}

export type ConsultIntakeAnswerMapDTO = {
  [questionKey: string]: string
}

export type ConsultIntakePrefillSourceDTO =
  | 'SELF_PROFILE'
  | 'BOARD'
  | 'SAVED_LOOK'
  | 'TASTE_VECTOR'
  | 'BOOKING_HISTORY'

export type ConsultIntakePrefillProvenanceDTO = {
  source: ConsultIntakePrefillSourceDTO
  sourceId: string | null
}

export type ConsultIntakePrefillSuggestionDTO = {
  questionKey: string
  value: string
  provenance: ConsultIntakePrefillProvenanceDTO[]
}

// Bounded metadata proves which owned signal families informed prefill without
// exposing raw vectors, cross-client records, or professional-private content.
export type ConsultIntakePrefillSignalDTO = {
  source: ConsultIntakePrefillSourceDTO
  available: boolean
}

export type ConsultIntakeRevisionDTO = {
  id: string
  revision: number
  packId: 'hair-color'
  packVersion: number
  schemaVersion: number
  complete: boolean
  answers: ConsultIntakeAnswerMapDTO
  createdAt: string
}

export type ConsultIntakeStateDTO = {
  consultId: string
  status: ConsultSessionStatus
  questionPack: ConsultIntakeQuestionPackDTO
  progress: {
    canComplete: boolean
    nextQuestionKey: string | null
    blocker:
      | 'REQUIRED_ANSWERS_MISSING'
      | 'GOAL_DIRECTION_REQUIRED'
      | 'GOAL_DIRECTION_UNRESOLVED'
      | null
  }
  prefillSuggestions: ConsultIntakePrefillSuggestionDTO[]
  prefillSignals: ConsultIntakePrefillSignalDTO[]
  latestRevision: ConsultIntakeRevisionDTO | null
}

export type ConsultIntakeSubmitRequestDTO = {
  idempotencyKey: string
  packVersion: number
  schemaVersion: number
  complete: boolean
  answers: ConsultIntakeAnswerMapDTO
}

export type ConsultIntakeStateResponseDTO = {
  intake: ConsultIntakeStateDTO
}

export type ConsultIntakeSubmitResponseDTO = ConsultIntakeStateResponseDTO & {
  replayed: boolean
}

export type ConsultInspirationSourceDTO = 'NONE' | ConsultInspirationSource

export type ConsultInspirationQuestionKeyDTO =
  | 'favorite_colors'
  | 'avoid_colors'
  | 'length_goal'
  | 'fullness_goal'
  | 'current_styling'
  | 'styling_walkthrough'
  | 'other_detail'

export type ConsultInspirationQuestionOptionDTO = {
  value: string
  label: string
}

export type ConsultInspirationQuestionDTO = {
  key: ConsultInspirationQuestionKeyDTO
  label: string
  helpText: string | null
  kind: 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TEXT'
  options: ConsultInspirationQuestionOptionDTO[]
  minSelections: number
  maxSelections: number
  allowText: boolean
}

export type ConsultInspirationAnswerDTO = {
  questionKey: ConsultInspirationQuestionKeyDTO
  selectedValues: string[]
  text: string | null
  sentiment: 'GOOD' | 'BAD' | 'BOTH' | 'NONE' | null
}

export type ConsultInspirationExactDetailDTO = {
  questionKey: ConsultInspirationQuestionKeyDTO
  value: string
  clientWords: string
  sentiment: 'LIKE' | 'DISLIKE' | 'GOAL' | 'CONTEXT'
}

export type ConsultInspirationPossibleInterpretationDTO = {
  clientDetailValue: string
  possibleMeaning: string
  confidence: 'POSSIBLE'
  evidence: 'CLIENT_SELECTION'
}

export type ConsultInspirationCatalogGuidanceDTO = {
  detail: 'LENGTH' | 'FULLNESS' | 'STYLING'
  message: string
  contextOnly: true
  automaticallyAdded: false
}

export type ConsultInspirationSourceStateDTO = {
  inspirationId: string
  source: Exclude<ConsultInspirationSourceDTO, 'NONE'>
  lookPostId: string | null
  imageReadEndpoint: string
  imageAvailable: boolean
  useExpiresAt: string | null
}

export type ConsultInspirationReviewDTO = {
  revisionId: string
  revision: number
  schemaVersion: number
  source: ConsultInspirationSourceDTO
  inspirationId: string | null
  complete: boolean
  answers: ConsultInspirationAnswerDTO[]
  exactClientDetails: ConsultInspirationExactDetailDTO[]
  possibleProfessionalInterpretation: ConsultInspirationPossibleInterpretationDTO[]
  catalogGuidance: ConsultInspirationCatalogGuidanceDTO[]
  createdAt: string
}

export type ConsultInspirationStateDTO = {
  consultId: string
  status: ConsultSessionStatus
  schemaVersion: number
  introduction: string
  referenceNote: string
  reflectionPrompt: string
  source: ConsultInspirationSourceStateDTO | null
  progress: {
    currentQuestion: ConsultInspirationQuestionDTO | null
    answeredQuestionCount: number
    specificDetailCount: number
    requiredSpecificDetailCount: 3
    canComplete: boolean
    blocker:
      | 'SOURCE_DECISION_REQUIRED'
      | 'QUESTIONS_REMAINING'
      | 'AT_LEAST_THREE_DETAILS_REQUIRED'
      | null
  }
  latestReview: ConsultInspirationReviewDTO | null
}

export type ConsultInspirationStateResponseDTO = {
  inspiration: ConsultInspirationStateDTO
}

export type ConsultInspirationSelectLookRequestDTO = {
  idempotencyKey: string
  source: Extract<
    ConsultInspirationSource,
    'PLATFORM_LOOK' | 'BOOKED_PRO_LOOK'
  >
  lookPostId: string
  schemaVersion: number
}

export type ConsultInspirationSkipRequestDTO = {
  idempotencyKey: string
  source: 'NONE'
  schemaVersion: number
}

export type ConsultInspirationMutationResponseDTO =
  ConsultInspirationStateResponseDTO & {
    replayed: boolean
  }

export type ConsultInspirationIssueUploadRequestDTO = {
  idempotencyKey: string
  schemaVersion: number
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  sizeBytes: number
  checksumSha256?: string
}

export type ConsultInspirationUploadDTO = {
  inspirationId: string
  schemaVersion: number
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  maxBytes: number
  expiresAt: string
  useExpiresAt: string
  token: string
  signedUrl: string | null
}

export type ConsultInspirationIssueUploadResponseDTO = {
  upload: ConsultInspirationUploadDTO
  replayed: boolean
}

export type ConsultInspirationAttachRequestDTO = {
  idempotencyKey: string
  inspirationId: string
  schemaVersion: number
}

export type ConsultInspirationAnswerRequestDTO = {
  idempotencyKey: string
  schemaVersion: number
  questionKey: ConsultInspirationQuestionKeyDTO
  selectedValues: string[]
  text?: string
  sentiment?: 'GOOD' | 'BAD' | 'BOTH' | 'NONE'
}

export type ConsultInspirationDeleteResponseDTO = {
  deleted: true
}

export type ConsultInspirationSignedReadResponseDTO = {
  url: string
  expiresInSeconds: number
}

export type ConsultCaptureShotKeyDTO =
  | 'hair_back'
  | 'hair_left'
  | 'hair_right'
  | 'hair_crown'
  | 'face_front'
  | 'face_side'
  | 'eyes_closeup'

export type ConsultCaptureShotDTO = {
  key: ConsultCaptureShotKeyDTO
  title: string
  instruction: string
  requirement: 'REQUIRED'
}

export type ConsultCaptureShotPackDTO = {
  // Legacy-stable wire id (pinned by iOS contract fixtures); version 2 of this
  // pack is the seven-shot full-analysis pack.
  id: 'hair-color-daylight'
  categorySlug: 'hair-color'
  version: number
  schemaVersion: number
  shots: readonly ConsultCaptureShotDTO[]
}

export type ConsultCaptureQualityReasonCodeDTO =
  | 'PASS'
  | 'WARM_INDOOR_LIGHT'
  | 'COLOR_CAST'
  | 'VIEW_MISMATCH'
  | 'HAIR_NOT_VISIBLE'
  | 'BLURRY'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'OTHER_QUALITY_FAILURE'

export type ConsultCaptureSlotStateDTO = {
  shotKey: ConsultCaptureShotKeyDTO
  state: 'EMPTY' | 'UPLOADED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'PURGED'
  captureId: string | null
  qualityReasonCode: ConsultCaptureQualityReasonCodeDTO | null
  retakeTip: string | null
  rawExpiresAt: string | null
  purgedAt: string | null
}

// Decision 2026-08-26: consult photos may be kept on the client's chart with
// consent. Default-on but visibly optional; the choice is recorded before
// analysis runs and the copy happens only after the analysis commits.
export type ConsultChartCopyStateDTO = {
  optIn: boolean
  decidedAt: string | null
}

export type ConsultChartCopyUpdateRequestDTO = {
  optIn: boolean
}

export type ConsultCaptureStateDTO = {
  consultId: string
  status: ConsultSessionStatus
  shotPack: ConsultCaptureShotPackDTO
  slots: ConsultCaptureSlotStateDTO[]
  chartCopy: ConsultChartCopyStateDTO
}

export type ConsultCaptureStateResponseDTO = {
  capture: ConsultCaptureStateDTO
}

export type ConsultCaptureIssueUploadRequestDTO = {
  idempotencyKey: string
  shotKey: ConsultCaptureShotKeyDTO
  shotPackVersion: number
  schemaVersion: number
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  sizeBytes: number
  checksumSha256?: string
}

export type ConsultCaptureUploadDTO = {
  uploadSessionId: string
  shotKey: ConsultCaptureShotKeyDTO
  shotPackVersion: number
  schemaVersion: number
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  maxBytes: number
  expiresAt: string
  rawExpiresAt: string
  token: string
  signedUrl: string | null
}

export type ConsultCaptureIssueUploadResponseDTO = {
  upload: ConsultCaptureUploadDTO
  replayed: boolean
}

export type ConsultCaptureAttachRequestDTO = {
  idempotencyKey: string
  uploadSessionId: string
  shotKey: ConsultCaptureShotKeyDTO
  shotPackVersion: number
  schemaVersion: number
}

export type ConsultCaptureAttachResponseDTO = {
  capture: ConsultCaptureStateDTO
  captureId: string
  replayed: boolean
}

export type ConsultCaptureQualityRequestDTO = {
  idempotencyKey: string
  shotPackVersion: number
  schemaVersion: number
}

export type ConsultCaptureQualityResultDTO = {
  captureId: string
  accepted: boolean
  reasonCode: ConsultCaptureQualityReasonCodeDTO
  retakeTip: string | null
  checkedAt: string
}

export type ConsultCaptureQualityResponseDTO = {
  quality: ConsultCaptureQualityResultDTO
  capture: ConsultCaptureStateDTO
  replayed: boolean
}

export type ConsultCaptureDeleteResponseDTO = {
  deleted: true
}

export type ConsultAnalysisConfidenceDTO = {
  min: number
  max: number
}

export type ConsultAnalysisEvidenceDTO =
  | 'hair_back'
  | 'hair_left'
  | 'hair_right'
  | 'hair_crown'
  | 'face_front'
  | 'face_side'
  | 'eyes_closeup'
  | 'intake'

export type ConsultAnalysisObservationDTO<T extends string> = {
  value: T
  confidence: ConsultAnalysisConfidenceDTO
  evidence: ConsultAnalysisEvidenceDTO[]
}

export type ConsultAnalysisSafetyCodeDTO =
  | 'PRIOR_REACTION'
  | 'REACTION_HISTORY_UNKNOWN'
  | 'RECENT_BOX_DYE'
  | 'RECENT_LIGHTENING'
  | 'CHEMICAL_HISTORY_UNKNOWN'
  | 'ALLERGY_HISTORY_UNKNOWN'
  | 'VISIBLE_COMPROMISE'

export type ConsultAnalysisServiceIntentDTO =
  | 'COLOR_CONSULTATION'
  | 'ROOT_TOUCH_UP'
  | 'ALL_OVER_COLOR'
  | 'HIGHLIGHTS'
  | 'BALAYAGE'
  | 'COLOR_CORRECTION'
  | 'TONER_GLOSS'
  | 'VIVID_COLOR'
  | 'OTHER_HAIR_COLOR'
  | 'STRAND_TEST'
  | 'PATCH_TEST'

export type ConsultAnalysisReferenceDTO =
  | {
      type: 'SERVICE'
      serviceId: string
      serviceCategoryId: string
    }
  | {
      type: 'SERVICE_CATEGORY'
      serviceId: null
      serviceCategoryId: string
    }

export type ConsultProfileUndertoneDTO =
  | 'WARM'
  | 'COOL'
  | 'NEUTRAL'
  | 'OLIVE'
  | 'UNKNOWN'

export type ConsultProfileContrastDTO = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'

export type ConsultProfileColorSeasonDTO =
  | 'BRIGHT_SPRING'
  | 'TRUE_SPRING'
  | 'LIGHT_SPRING'
  | 'LIGHT_SUMMER'
  | 'TRUE_SUMMER'
  | 'SOFT_SUMMER'
  | 'SOFT_AUTUMN'
  | 'TRUE_AUTUMN'
  | 'DEEP_AUTUMN'
  | 'DEEP_WINTER'
  | 'TRUE_WINTER'
  | 'BRIGHT_WINTER'
  | 'UNKNOWN'

export type ConsultProfileFaceProportionDTO =
  | 'WIDER'
  | 'BALANCED'
  | 'LONGER'
  | 'UNKNOWN'

export type ConsultProfileJawlineDTO =
  | 'SOFTLY_ROUNDED'
  | 'BALANCED'
  | 'ANGULAR'
  | 'UNKNOWN'

export type ConsultProfileForeheadDTO =
  | 'SHORTER'
  | 'BALANCED'
  | 'TALLER'
  | 'UNKNOWN'

export type ConsultProfileFeatureBalanceDTO =
  | 'SOFT'
  | 'BLENDED'
  | 'STRUCTURED'
  | 'UNKNOWN'

export type ConsultProfileEyeShapeDTO =
  | 'ALMOND'
  | 'ROUND'
  | 'HOODED'
  | 'MONOLID'
  | 'DOWNTURNED'
  | 'UPTURNED'
  | 'DEEP_SET'
  | 'PROMINENT'
  | 'UNKNOWN'

export type ConsultProfileEyeSpacingDTO =
  | 'CLOSE_SET'
  | 'BALANCED'
  | 'WIDE_SET'
  | 'UNKNOWN'

export type ConsultProfileBrowDensityDTO =
  | 'SPARSE'
  | 'MEDIUM'
  | 'FULL'
  | 'UNKNOWN'

export type ConsultProfileBrowShapeDTO =
  | 'STRAIGHT'
  | 'SOFT_ARCH'
  | 'HIGH_ARCH'
  | 'ROUNDED'
  | 'UNKNOWN'

// Schema v2: the observed feature profile behind the style directions. Every
// entry is an evidence-cited observation with an honest UNKNOWN state; none of
// these fields may carry identity, ethnicity, age, or medical meaning.
export type ConsultAnalysisFeatureProfileDTO = {
  skinUndertone: ConsultAnalysisObservationDTO<ConsultProfileUndertoneDTO>
  contrastLevel: ConsultAnalysisObservationDTO<ConsultProfileContrastDTO>
  colorSeason: ConsultAnalysisObservationDTO<ConsultProfileColorSeasonDTO>
  faceProportion: ConsultAnalysisObservationDTO<ConsultProfileFaceProportionDTO>
  jawline: ConsultAnalysisObservationDTO<ConsultProfileJawlineDTO>
  foreheadProportion: ConsultAnalysisObservationDTO<ConsultProfileForeheadDTO>
  featureBalance: ConsultAnalysisObservationDTO<ConsultProfileFeatureBalanceDTO>
  eyeShape: ConsultAnalysisObservationDTO<ConsultProfileEyeShapeDTO>
  eyeSpacing: ConsultAnalysisObservationDTO<ConsultProfileEyeSpacingDTO>
  browDensity: ConsultAnalysisObservationDTO<ConsultProfileBrowDensityDTO>
  browShape: ConsultAnalysisObservationDTO<ConsultProfileBrowShapeDTO>
}

export type ConsultStyleDomainDTO =
  | 'HAIR_COLOR_HARMONY'
  | 'CUT_AND_SHAPE'
  | 'BANGS'
  | 'BROWS'
  | 'LASHES'
  | 'MAKEUP'
  | 'COLOR_PALETTE'

// Schema v2: one professionally framed direction per style domain. These are
// discussion directions grounded in the feature profile — never bookable
// service references and never promises.
export type ConsultStyleDirectionDTO = {
  domain: ConsultStyleDomainDTO
  title: string
  direction: string
  whyItFlatters: string
  confidence: ConsultAnalysisConfidenceDTO
  evidence: ConsultAnalysisEvidenceDTO[]
  discussWithProfessional: true
}

export type ConsultAnalysisPayloadDTO = {
  profile: ConsultAnalysisFeatureProfileDTO
  styleDirections: ConsultStyleDirectionDTO[]
  core: {
    currentLevel: {
      min: number | null
      max: number | null
      confidence: ConsultAnalysisConfidenceDTO
      evidence: ConsultAnalysisEvidenceDTO[]
    }
    currentTone: ConsultAnalysisObservationDTO<
      'ASHY' | 'NEUTRAL' | 'GOLDEN' | 'COPPER' | 'RED' | 'MIXED' | 'UNKNOWN'
    >
    visibleCondition: ConsultAnalysisObservationDTO<
      'NO_VISIBLE_CONCERN' | 'POSSIBLE_COMPROMISE' | 'UNKNOWN'
    >
    density: ConsultAnalysisObservationDTO<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'>
    texture: ConsultAnalysisObservationDTO<
      'STRAIGHT' | 'WAVY' | 'CURLY' | 'COILY' | 'MIXED' | 'UNKNOWN'
    >
  }
  hairColorLens: {
    goal: string
    history: string
    constraints: string
    maintenance: string
    appointmentContext: string
    achievability:
      | 'LIKELY_SINGLE_APPOINTMENT'
      | 'LIKELY_MULTI_APPOINTMENT'
      | 'REQUIRES_PRO_ASSESSMENT'
      | 'UNKNOWN'
    achievabilityReason: string
    discussWithProfessional: true
  }
  safetyFlags: Array<{
    code: ConsultAnalysisSafetyCodeDTO
    summary: string
    discussWithProfessional: true
  }>
  recommendations: Array<{
    serviceIntent: ConsultAnalysisServiceIntentDTO
    title: string
    rationale: string
    achievability: string
    discussWithProfessional: true
    reference: ConsultAnalysisReferenceDTO
  }>
}

export type ConsultAnalysisResultDTO = {
  revisionId: string
  revision: number
  analysis: ConsultAnalysisPayloadDTO
  createdAt: string
}

export type ConsultAnalysisStateDTO = {
  consultId: string
  status: ConsultSessionStatus
  schemaVersion: number
  promptVersion: string
  result: ConsultAnalysisResultDTO | null
}

export type ConsultAnalysisStartRequestDTO = {
  idempotencyKey: string
  schemaVersion: number
  promptVersion: string
}

export type ConsultAnalysisStateResponseDTO = {
  analysis: ConsultAnalysisStateDTO
}

export type ConsultAnalysisStartResponseDTO = ConsultAnalysisStateResponseDTO & {
  replayed: boolean
}

export type ConsultBriefClientIntakeItemDTO = {
  questionKey: string
  question: string
  answerCode: string
  answer: string
}

export type ConsultBriefAiObservationsDTO = {
  currentLevel: ConsultAnalysisPayloadDTO['core']['currentLevel']
  currentTone: ConsultAnalysisPayloadDTO['core']['currentTone']
  visibleCondition: ConsultAnalysisPayloadDTO['core']['visibleCondition']
  density: ConsultAnalysisPayloadDTO['core']['density']
  texture: ConsultAnalysisPayloadDTO['core']['texture']
  goalSummary: string
  historySummary: string
  constraintsSummary: string
  maintenanceSummary: string
  appointmentContextSummary: string
}

export type ConsultBriefAchievabilityDirectionDTO = {
  direction: string
  assessment: ConsultAnalysisPayloadDTO['hairColorLens']['achievability']
  context: string
  discussWithProfessional: true
}

export type ConsultBriefRecommendationDirectionDTO = {
  title: string
  why: string
  direction: string
  reference: ConsultAnalysisReferenceDTO
  discussWithProfessional: true
}

export type ConsultBriefInspirationDTO = {
  revisionId: string | null
  source: ConsultInspirationSourceDTO
  inspirationId: string | null
  lookPostId: string | null
  mediaEndpoint: string | null
  referenceNote: string
  exactClientDetails: ConsultInspirationExactDetailDTO[]
  possibleProfessionalInterpretation: ConsultInspirationPossibleInterpretationDTO[]
  catalogGuidance: ConsultInspirationCatalogGuidanceDTO[]
}

export type ConsultBriefFeedbackRatingDTO = 'ACCURATE_USEFUL' | 'OFF'

export type ConsultBriefFeedbackDTO = {
  rating: ConsultBriefFeedbackRatingDTO
  createdAt: string
}

// Book the Look, B3 — the pro-facing line-item service estimate for a
// look-anchored consult (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 6).
//
// PRO-FACING ONLY. Nothing here reaches a client surface in this slice: the
// client sees "Starting at $X" with B4's booking flow (decision 5), and a LOOK
// still never names the service that produced it (B1). This type is reachable
// solely from the pro brief, which is already founder-gated and
// pro-authenticated.
//
// Prices are decimal STRINGS, matching how every other money field crosses this
// wire — a JSON number would round.
export type ConsultServiceEstimateLineDTO = {
  serviceId: string
  offeringId: string
  serviceName: string
  source: ConsultServiceEstimateLineSource
  /** What in the look or the analysis put this line here. Never invented. */
  rationale: string
  estimatedPrice: string
  /** Rounded UP to `stepMinutes` — an estimate never understates the day. */
  estimatedDurationMinutes: number
  // The pro's correction, once B5/B6 records one. Null until then.
  proFinalPrice: string | null
  proFinalDurationMinutes: number | null
  proFinalNote: string | null
  proFinalAt: string | null
}

export type ConsultServiceEstimateDTO = {
  status: ConsultServiceEstimateStatus
  /** Set exactly when `status` is REFUSED: the pro's menu can't express it. */
  refusalCode: ConsultServiceEstimateRefusalCode | null
  /** Which of the pro's two price/duration columns the lines were read from. */
  locationType: ServiceLocationType
  /** Null only on a PRO_SCHEDULING_NOT_READY refusal. */
  stepMinutes: number | null
  bufferMinutes: number | null
  schemaVersion: number
  derivationVersion: string
  sourceAnalysisRevisionId: string
  lines: ConsultServiceEstimateLineDTO[]
  createdAt: string
}

// Book the Look, B4 — the CLIENT-facing booking proposal
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 3, 4, 5 and 11).
//
// The mirror image of the estimate above, and deliberately not the same type.
// The estimate is the PRO's line-item derivation with its rationales, priced in
// her salon column; this is what a client is shown when she has chosen a mode,
// re-derived under that mode.
//
// 🔴 A line here carries NO rationale and NO source. The reasons are the pro's
// half of decision 6 — "which look/photo attributes drove each line" — and a
// LOOK still never names the service that produced it (B1). What the client
// gets is the shape of her appointment: how long it takes, and one number.
export type ConsultBookingProposalLineDTO = {
  serviceName: string
  /** Decimal string, like every other money field on this wire. */
  price: string
  /** Rounded UP to the pro's slot granularity — never understates her day. */
  durationMinutes: number
}

// Why no proposal could be made. `SAFETY_REVIEW_REQUIRED` is the load-bearing
// one: the analysis routed to safety prerequisites, so the estimate's floor is
// a service it explicitly declined to recommend yet, and no amount of the pro's
// menu being well-configured makes that bookable unattended.
export type ConsultBookingProposalRefusalCodeDTO =
  | 'ESTIMATE_MISSING'
  | 'ESTIMATE_REFUSED'
  | 'SAFETY_REVIEW_REQUIRED'
  | 'OFFERING_OFF_MENU'
  | 'MODE_NOT_OFFERED'
  | 'MODE_PRICE_UNSET'
  | 'MODE_DURATION_UNSET'
  | 'PRO_SCHEDULING_NOT_READY'
  | 'SLOT_TOO_LONG'

export type ConsultBookingProposalDTO = {
  consultId: string
  /** The mode this proposal was re-derived for. Echoed, never assumed. */
  locationType: ServiceLocationType
  /** The offering a hold and a finalize must be placed against — the floor. */
  offeringId: string
  /**
   * The identity of what would be booked, so the client flow (B4b) never has to
   * assemble it: the pro whose grid to read, the floor offering's SERVICE (what
   * availability is keyed on) and the look this consult is anchored to (the
   * discovery reference finalize attributes the booking to).
   *
   * 🔴 `serviceId` is a routing key, not a label. A LOOK never names the service
   * that produced it (B1) — nothing client-side may render this.
   */
  professionalId: string
  serviceId: string
  lookPostId: string
  /** Sum of the line durations, excluding buffer (as every booking width is). */
  totalDurationMinutes: number
  /** Sum of the line prices, as a decimal string. */
  startingAtPrice: string
  /**
   * The composed label, e.g. "Starting at $340" — rendered, never re-assembled
   * client-side (lib/looks/startingPrice.ts). Null when the total is not
   * positive, which every surface renders as no price rather than "$0".
   */
  startingAtLabel: string | null
  /**
   * Decision 5 travels WITH the price: this is an estimate from her photos and
   * the pro makes the final call. Never render the number without these.
   */
  estimateNote: string
  proDecidesNote: string
  /**
   * What committing will actually do, decided by the pro's `autoAcceptBookings`
   * toggle (decision 4). `true` books instantly; `false` sends a request that
   * ALREADY holds the slot.
   */
  autoAccepts: boolean
  /**
   * The rendered sentence for that outcome. Derived from the same
   * `getClientSubmittedBookingStatus` fork the commit runs, so the promise made
   * here cannot disagree with the booking that follows.
   */
  commitNote: string
  lines: ConsultBookingProposalLineDTO[]
}

export type ConsultBookingProposalAvailabilityDTO = {
  /** True exactly when `proposal` is non-null. */
  available: boolean
  reason: ConsultBookingProposalRefusalCodeDTO | null
  proposal: ConsultBookingProposalDTO | null
  /**
   * The consult's professional, present on REFUSALS as well as on answers.
   *
   * Every refusal here is a rendered, explained state rather than a dead end,
   * and the way out of all of them is the same: message the pro, who already has
   * the consultation brief. That link needs an id, and a refusal answer that
   * carried none would force the client to assemble one — so the authorized
   * answer carries it. It leaks nothing: this endpoint has already established
   * that the caller owns this consult with this pro.
   */
  professionalId: string
}

export type ConsultBookingProposalResponseDTO = {
  proposal: ConsultBookingProposalAvailabilityDTO
}

export type ConsultProBriefDTO = {
  consultId: string
  // See ConsultClientResultsDTO: exactly one anchor is set, and `lookPostId`
  // is optional on the wire to keep the fixture contract purely additive.
  bookingId: string | null
  lookPostId?: string | null
  professionalId: string
  serviceCategoryId: string
  briefRevisionId: string
  briefRevision: number
  sourceAnalysisRevisionId: string
  sourceAnalysisRevision: number
  intakeRevisionId: string
  inspiration: ConsultBriefInspirationDTO
  clientIntake: ConsultBriefClientIntakeItemDTO[]
  aiObservations: ConsultBriefAiObservationsDTO
  // Brief schema v3: the full feature profile and per-domain style directions
  // sit beside the hair observations, never blended into the client's words.
  profile: ConsultAnalysisFeatureProfileDTO
  styleDirections: ConsultStyleDirectionDTO[]
  safetyFlags: ConsultAnalysisPayloadDTO['safetyFlags']
  achievabilityDirection: ConsultBriefAchievabilityDirectionDTO
  recommendationDirections: ConsultBriefRecommendationDirectionDTO[]
  // Book the Look, B3. OPTIONAL on the wire — like `lookPostId` above, so the
  // published schema grows by addition only and shipped iOS fixtures stay
  // valid. Present only for a LOOK-anchored consult; a booking-anchored one has
  // real BookingServiceItem prices and nothing to translate.
  serviceEstimate?: ConsultServiceEstimateDTO | null
  feedback: ConsultBriefFeedbackDTO | null
  createdAt: string
}

export type ConsultProBriefResponseDTO = {
  brief: ConsultProBriefDTO
}

export type ConsultProBriefHistoryResponseDTO = {
  briefs: ConsultProBriefDTO[]
}

export type ConsultBriefFeedbackRequestDTO = {
  rating: ConsultBriefFeedbackRatingDTO
}

export type ConsultBriefFeedbackResponseDTO = {
  feedback: ConsultBriefFeedbackDTO
  replayed: boolean
}

export type ConsultClientResultsDTO = {
  consultId: string
  // Exactly one of these is set — a consult is anchored to a booking or, since
  // Book the Look (B2), to a look. `bookingId` widened rather than being joined
  // by a nullable twin so results stay ONE shape and ONE mapper; a widening
  // keeps every previously valid document valid, and a look-anchored consult is
  // unreachable from any shipped native build, whose only consult entry points
  // are keyed by bookingId. `lookPostId` is OPTIONAL on the wire so the
  // cross-repo fixture contract stays a pure addition — a tovis-ios fixture
  // written before this field still validates (see
  // tools/check-ios-fixture-contract.mjs).
  bookingId: string | null
  lookPostId?: string | null
  serviceCategoryId: string
  briefRevisionId: string
  briefRevision: number
  analysisRevisionId: string
  analysisRevision: number
  intakeRevisionId: string
  // Client-declared answers intentionally precede AI-derived observations in
  // both this wire shape and the C7 render order.
  clientIntake: ConsultBriefClientIntakeItemDTO[]
  aiObservations: ConsultBriefAiObservationsDTO
  // Brief schema v3: feature profile + per-domain style directions, rendered
  // after the client's words and the hair observations.
  profile: ConsultAnalysisFeatureProfileDTO
  styleDirections: ConsultStyleDirectionDTO[]
  // Always present and structurally separate, including when empty.
  safetyFlags: ConsultAnalysisPayloadDTO['safetyFlags']
  achievabilityDirection: ConsultBriefAchievabilityDirectionDTO
  recommendationDirections: ConsultBriefRecommendationDirectionDTO[]
  meCardTeaser: {
    locked: true
    tapped: boolean
  }
  createdAt: string
}

export type ConsultClientResultsResponseDTO = {
  results: ConsultClientResultsDTO
}

export type ConsultMeCardTeaserTapResponseDTO = {
  teaser: {
    locked: true
    tapped: true
  }
  replayed: boolean
}

export type ConsultClientResultsErrorCode =
  | 'CONSULT_RESULTS_NOT_FOUND'
  | 'CONSULT_RESULTS_UNAVAILABLE'

export type ConsultClientResultsErrorDTO = {
  ok: false
  error: string
  code: ConsultClientResultsErrorCode
}

export type ConsultBriefErrorCode =
  | 'CONSULT_BRIEF_NOT_FOUND'
  | 'CONSULT_BRIEF_INVALID_REQUEST'
  | 'CONSULT_BRIEF_RATING_CONFLICT'
  | 'CONSULT_BRIEF_UNAVAILABLE'

export type ConsultBriefErrorDTO = {
  ok: false
  error: string
  code: ConsultBriefErrorCode
}

export type ConsultAgreementErrorCode =
  | 'CONSULT_NOT_FOUND'
  | 'CONSULT_AGREEMENTS_UNAVAILABLE'
  | 'CONSULT_AGREEMENT_VERSION_MISMATCH'
  | 'CONSULT_INVALID_STATE'
  | 'CONSULT_ACCEPTANCE_ALREADY_REVOKED'
  | 'CONSULT_INVALID_REQUEST'
  | 'CONSULT_PREREQUISITES_REQUIRED'
  | 'CONSULT_PACK_VERSION_MISMATCH'
  | 'CONSULT_SCHEMA_VERSION_MISMATCH'
  | 'CONSULT_INVALID_ANSWERS'
  | 'CONSULT_GOAL_DIRECTION_REQUIRED'
  | 'CONSULT_GOAL_DIRECTION_UNRESOLVED'
  | 'CONSULT_IDEMPOTENCY_CONFLICT'
  | 'CONSULT_BOOKING_INELIGIBLE'
  | 'CONSULT_CAPTURE_PACK_VERSION_MISMATCH'
  | 'CONSULT_CAPTURE_SCHEMA_VERSION_MISMATCH'
  | 'CONSULT_CAPTURE_INVALID_SLOT'
  | 'CONSULT_CAPTURE_UPLOAD_EXPIRED'
  | 'CONSULT_CAPTURE_UPLOAD_MISMATCH'
  | 'CONSULT_CAPTURE_OBJECT_INVALID'
  | 'CONSULT_CAPTURE_QUALITY_UNAVAILABLE'
  | 'CONSULT_CAPTURE_QUALITY_FAILED'
  | 'CONSULT_CAPTURE_QUALITY_LIMIT_EXCEEDED'
  | 'CONSULT_CAPTURE_STORAGE_UNAVAILABLE'
  | 'CONSULT_ANALYSIS_SCHEMA_VERSION_MISMATCH'
  | 'CONSULT_ANALYSIS_PROMPT_VERSION_MISMATCH'
  | 'CONSULT_ANALYSIS_PREREQUISITES_REQUIRED'
  | 'CONSULT_ANALYSIS_CAPTURES_REQUIRED'
  | 'CONSULT_ANALYSIS_INSPIRATION_REQUIRED'
  | 'CONSULT_ANALYSIS_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_SCHEMA_VERSION_MISMATCH'
  | 'CONSULT_INSPIRATION_LOOK_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_SOURCE_REQUIRED'
  | 'CONSULT_INSPIRATION_SOURCE_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_UPLOAD_EXPIRED'
  | 'CONSULT_INSPIRATION_UPLOAD_MISMATCH'
  | 'CONSULT_INSPIRATION_OBJECT_INVALID'
  | 'CONSULT_INSPIRATION_STORAGE_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_INVALID_ANSWER'
  | 'CONSULT_INSPIRATION_QUESTION_OUT_OF_ORDER'
  | 'CONSULT_LOOK_NOT_CONSULTABLE'

export type ConsultAgreementErrorDTO = {
  ok: false
  error: string
  code: ConsultAgreementErrorCode
}
