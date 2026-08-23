// lib/dto/consult.ts
//
// Wire DTO for the AI Consult Phase 0 booking-attached hair-color pilot.
// Sensitive intake content is exposed only through the consent-gated intake
// route and comes from immutable ConsultRevision rows.

import type {
  ConsultAgreementKind,
  ConsultInspirationSource,
  ConsultSessionStatus,
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

export type ConsultCaptureShotDTO = {
  key: ConsultCaptureShotKeyDTO
  title: string
  instruction: string
  requirement: 'REQUIRED'
}

export type ConsultCaptureShotPackDTO = {
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

export type ConsultCaptureStateDTO = {
  consultId: string
  status: ConsultSessionStatus
  shotPack: ConsultCaptureShotPackDTO
  slots: ConsultCaptureSlotStateDTO[]
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

export type ConsultAnalysisPayloadDTO = {
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

export type ConsultProBriefDTO = {
  consultId: string
  bookingId: string
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
  safetyFlags: ConsultAnalysisPayloadDTO['safetyFlags']
  achievabilityDirection: ConsultBriefAchievabilityDirectionDTO
  recommendationDirections: ConsultBriefRecommendationDirectionDTO[]
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
  bookingId: string
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

export type ConsultAgreementErrorDTO = {
  ok: false
  error: string
  code: ConsultAgreementErrorCode
}
