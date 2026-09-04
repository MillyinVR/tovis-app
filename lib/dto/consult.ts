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

// GET /api/v1/client/consult/[id] — a consult looked up by its OWN id, which
// is the one route that legitimately serves both anchors. Web reads only
// `status` off it; iOS never calls this route (its flows resolve by bookingId
// or lookPostId), so the union costs no shipped decoder anything.
export type ConsultSessionLookupDTO = ConsultSessionDTO | ConsultLookSessionDTO

export type ConsultSessionLookupResponseDTO = {
  consult: ConsultSessionLookupDTO
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

// `id` and `categorySlug` name WHICH pack was served (lib/consult/intake/
// registry.ts): 'hair-color' for the colour category, 'hair-general' for
// every other hair service, 'general-service' for everything else. Shipped
// clients render the pack generically by key, so a new id is additive.
export type ConsultIntakeQuestionPackDTO = {
  id: string
  categorySlug: string
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
  packId: string
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
  /**
   * Server-absolute path of the ONE route that answers this consult's
   * inspiration image as {@link ConsultInspirationSignedReadResponseDTO} —
   * `{ url, expiresInSeconds }` — for EVERY source, uploads and looks alike.
   *
   * 🔴 It may only ever carry a route that returns that shape. It once forked
   * on the source and pointed look-anchored consults at `/api/v1/looks/{id}`,
   * which answers a look DTO instead; the clients read `undefined` off it and
   * either looped (web scheduled its refresh from `NaN`) or silently rendered
   * nothing (iOS refused the path and swallowed the throw).
   */
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

// Every shot key any capture pack defines (lib/consult/capture/registry.ts):
// the hair pack's seven, plus the two treatment-area views the area pack adds
// for nails, body and any family nobody has modelled yet. Additive.
export type ConsultCaptureShotKeyDTO =
  | 'hair_back'
  | 'hair_left'
  | 'hair_right'
  | 'hair_crown'
  | 'face_front'
  | 'face_side'
  | 'eyes_closeup'
  | 'area_wide'
  | 'area_closeup'

export type ConsultCaptureShotDTO = {
  key: ConsultCaptureShotKeyDTO
  title: string
  instruction: string
  requirement: 'REQUIRED'
}

export type ConsultCaptureShotPackDTO = {
  // Which pack was served: 'hair-color-daylight' (HAIR), 'face-daylight'
  // (skin, brows & lashes, makeup) or 'area-daylight' (everything else).
  // Shipped clients render the pack generically by shot, so a new id is
  // additive; the hair pack keeps its legacy-stable id and version.
  id: string
  categorySlug: string
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
  | 'SUBJECT_NOT_VISIBLE'
  | 'BLURRY'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'OTHER_QUALITY_FAILURE'

// The colour-fidelity findings that are a REJECTION on a full view and only a
// WARNING on a tight crop (a skin-filled close-up, where the frame is mostly
// one subject and a warm reading is as likely to be the skin as the room —
// see lib/consult/capture/types.ts `framing`). A warning never blocks the
// slot: it rides along on the accepted result so the analysis, the pro brief
// and any later audit know the colour on this frame is not fully trustworthy.
export type ConsultCaptureQualityWarningCodeDTO =
  | 'WARM_INDOOR_LIGHT'
  | 'COLOR_CAST'

export type ConsultCaptureSlotStateDTO = {
  shotKey: ConsultCaptureShotKeyDTO
  state: 'EMPTY' | 'UPLOADED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'PURGED'
  captureId: string | null
  qualityReasonCode: ConsultCaptureQualityReasonCodeDTO | null
  qualityWarningCode: ConsultCaptureQualityWarningCodeDTO | null
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
  /** Non-null only on an accepted tight-crop shot; see the type's own note. */
  warningCode: ConsultCaptureQualityWarningCodeDTO | null
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

export type ConsultAnalysisEvidenceDTO = ConsultCaptureShotKeyDTO | 'intake'

export type ConsultAnalysisObservationDTO<T extends string> = {
  value: T
  confidence: ConsultAnalysisConfidenceDTO
  evidence: ConsultAnalysisEvidenceDTO[]
}

/**
 * The salon level scale, 1 (black) to 10 (lightest blonde), plus UNKNOWN.
 *
 * ONE vocabulary, because two artefacts report it and they are meant to be
 * compared: the client's own hair (`ConsultAnalysisPayloadDTO.core`) and the
 * reference she brought (`ConsultInspirationAnalysisAttributesDTO`). Both
 * report a `baseLevel` and a `lightestLevel` — see lib/consult/hairLevel.ts
 * for why one number per head was never enough.
 */
export type ConsultHairLevelDTO =
  | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | 'LEVEL_4' | 'LEVEL_5'
  | 'LEVEL_6' | 'LEVEL_7' | 'LEVEL_8' | 'LEVEL_9' | 'LEVEL_10'
  | 'UNKNOWN'

// Analysis schema v3 (service-aware consult, 2026-09-03): the safety codes any
// intake pack's policy can raise (lib/consult/safetyFlags.ts). Additive over
// the colour-only set.
export type ConsultAnalysisSafetyCodeDTO =
  | 'PRIOR_REACTION'
  | 'REACTION_HISTORY_UNKNOWN'
  | 'RECENT_BOX_DYE'
  | 'RECENT_LIGHTENING'
  | 'RECENT_CHEMICAL_SERVICE'
  | 'CHEMICAL_HISTORY_UNKNOWN'
  | 'ALLERGY_HISTORY_UNKNOWN'
  | 'KNOWN_ALLERGY'
  | 'SENSITIVITY_REPORTED'
  | 'VISIBLE_COMPROMISE'

// What a recommendation IS: a service from the professional's menu (named in
// `serviceName`), a consultation with the professional, or one of the two
// deterministic safety tests the routing adds. The colour-only intent enum
// (BALAYAGE, TONER_GLOSS, …) is gone: the analysis names the pro's actual
// service instead of guessing a colour technique.
export type ConsultAnalysisServiceIntentDTO =
  | 'SERVICE'
  | 'CONSULTATION'
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
  // Schema v4: two NAMED levels replace v3's positional `currentLevel:
  // {min, max}`, which never said whether the pair meant dark-to-light or a
  // spread of uncertainty — while rendering on screen as "Level 5–7", which
  // reads as the former, from a model that was asked for neither.
  // `baseLevel` is the depth at the root, `lightestLevel` the lightest
  // dominant colour; a solid single-process reports the same value in both.
  core: {
    baseLevel: ConsultAnalysisObservationDTO<ConsultHairLevelDTO>
    lightestLevel: ConsultAnalysisObservationDTO<ConsultHairLevelDTO>
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
  // Schema v3: the lens is about THE SERVICE this consult is for, whatever it
  // is; the eight fields are the ones the colour lens carried.
  serviceLens: {
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
    /** The menu service, exactly as the menu names it; null unless SERVICE. */
    serviceName: string | null
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
  baseLevel: ConsultAnalysisPayloadDTO['core']['baseLevel']
  lightestLevel: ConsultAnalysisPayloadDTO['core']['lightestLevel']
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
  assessment: ConsultAnalysisPayloadDTO['serviceLens']['achievability']
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

// ── P4: what the consult read off the client's inspiration reference ────────
// Stage 1 of docs/consult/tovis-ai-consult-handoff.md. Eight hair-colour
// attributes, each in the same observation shape the feature profile uses
// (value + confidence range + evidence) plus a region: where on the reference
// the attribute was read from. Enum values only — this artefact carries no
// free text, so it cannot describe the person in the photograph.

export type ConsultInspirationAnalysisToneDTO =
  | 'WARM' | 'COOL' | 'NEUTRAL' | 'UNKNOWN'

export type ConsultInspirationAnalysisTechniqueDTO =
  | 'SINGLE_PROCESS' | 'BALAYAGE' | 'FOIL_HIGHLIGHTS' | 'BABYLIGHTS'
  | 'LOWLIGHTS' | 'COLOR_MELT' | 'GLOSS_ONLY' | 'DOUBLE_PROCESS'
  | 'NATURAL_UNCOLORED' | 'UNKNOWN'

export type ConsultInspirationAnalysisPlacementDTO =
  | 'ALL_OVER' | 'FACE_FRAMING' | 'MIDS_TO_ENDS' | 'ENDS_ONLY'
  | 'SURFACE_ONLY' | 'UNDERNEATH' | 'PANELS' | 'UNKNOWN'

export type ConsultInspirationAnalysisRootBlendDTO =
  | 'SOLID_TO_ROOT' | 'SHADOW_ROOT' | 'SEAMLESS_MELT' | 'GROWN_OUT' | 'UNKNOWN'

export type ConsultInspirationAnalysisFinishDTO =
  | 'HIGH_SHINE' | 'SATIN' | 'MATTE' | 'UNKNOWN'

export type ConsultInspirationAnalysisDimensionDTO =
  | 'FLAT' | 'SUBTLE' | 'MEDIUM' | 'HIGH_CONTRAST' | 'UNKNOWN'

/**
 * Where on the reference the attribute is most visible, normalized to the
 * image (0..1, top-left origin). Null when the value is UNKNOWN.
 *
 * Nothing renders it yet (Tori, 2026-09-04); P5 will.
 */
export type ConsultInspirationAnalysisRegionDTO = {
  x: number
  y: number
  w: number
  h: number
}

export type ConsultInspirationAnalysisObservationDTO<T extends string> = {
  value: T
  confidence: ConsultAnalysisConfidenceDTO
  evidence: 'inspiration'[]
  region: ConsultInspirationAnalysisRegionDTO | null
}

export type ConsultInspirationAnalysisAttributesDTO = {
  baseLevel: ConsultInspirationAnalysisObservationDTO<ConsultHairLevelDTO>
  lightestLevel: ConsultInspirationAnalysisObservationDTO<ConsultHairLevelDTO>
  tone: ConsultInspirationAnalysisObservationDTO<ConsultInspirationAnalysisToneDTO>
  technique: ConsultInspirationAnalysisObservationDTO<ConsultInspirationAnalysisTechniqueDTO>
  placement: ConsultInspirationAnalysisObservationDTO<ConsultInspirationAnalysisPlacementDTO>
  rootBlend: ConsultInspirationAnalysisObservationDTO<ConsultInspirationAnalysisRootBlendDTO>
  finish: ConsultInspirationAnalysisObservationDTO<ConsultInspirationAnalysisFinishDTO>
  dimension: ConsultInspirationAnalysisObservationDTO<ConsultInspirationAnalysisDimensionDTO>
}

/**
 * The stored artefact, pinned to the guided-inspiration revision it was read
 * against: a new inspiration revision makes this one stale, and the pro brief
 * declines to show a stale one rather than showing the wrong picture's colour.
 */
export type ConsultInspirationAnalysisDTO = {
  revisionId: string
  /** The INSPIRATION revision this was read against. */
  inspirationRevisionId: string
  /** The attached ConsultInspiration row whose image was read. */
  inspirationId: string
  source: Exclude<ConsultInspirationSourceDTO, 'NONE'>
  schemaVersion: number
  promptVersion: string
  model: string
  attributes: ConsultInspirationAnalysisAttributesDTO
  createdAt: string
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
  /**
   * Book the Look, B7 — the enhancements the analysis recommends on top of the
   * look (decision 10). Opt-in: `selected` is false unless this client asked
   * for it, and `lines` above already reflects whatever she did ask for.
   *
   * Empty for a consult whose analysis recommended nothing beyond the look
   * itself, which every surface renders as no section rather than an empty one.
   */
  recommendations: ConsultBookingProposalRecommendationDTO[]
}

/**
 * One enhancement, as the client is offered it (B7, decision 10).
 *
 * 🔴 THERE IS NO SERVICE NAME ON THIS TYPE, ON PURPOSE. Decision 10 gives the
 * register — "a gloss keeps this tone from going brassy", never "add Toner
 * Gloss" — and decision 1 says a look never names the service that produced it.
 * A `serviceName` field here would be one careless render away from putting the
 * taxonomy back on the client's screen, so the wire simply does not carry one.
 *
 * `outcome` is the ANALYSIS's own rationale for this recommendation, read from
 * the revision the estimate pinned. Never re-written and never composed from a
 * service name.
 *
 * Both labels are composed on the SERVER (lib/consult/enhancementOffer.ts) and
 * are null when there is nothing to print — a complimentary enhancement has no
 * price delta, an instant one has no duration delta. Never render "+$0".
 */
export type ConsultBookingProposalRecommendationDTO = {
  /**
   * The estimate line this offers. It is also the id the client's answer names,
   * on the wire and in the URL — never a price and never a duration, so nothing
   * she can edit decides what she is charged.
   */
  estimateLineId: string
  outcome: string
  priceDeltaLabel: string | null
  durationDeltaLabel: string | null
  selected: boolean
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

// Book the Look, B5 — the PRO's review of a booking proposal
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decisions 4, 6 and 7).
//
// PRO-FACING ONLY, and deliberately a third type rather than a reuse of either
// neighbour above. The estimate is her salon-column derivation with its
// reasons; the proposal DTO is what the CLIENT was shown. This is the join of
// the two, from her side: the reason each line exists (decision 6, off the
// estimate line) beside the number this client actually agreed to (the
// mode-reconciled proposal line), with a place for her correction.
//
// 🔴 `proposedPrice` / `proposedDurationMinutes` are the PROPOSAL's numbers,
// never the estimate's. The estimate prices the SALON column because a
// look-anchored consult had chosen no mode yet; showing a pro a salon figure
// as "what she agreed to" for a mobile booking would be a lie, and correcting
// against it would poison decision 7's pair. The chain
// (salon estimate → mode-reconciled proposal → pro final) stays walkable
// through `estimateLineId`.

/**
 * What the pro's review says about one line, derived on the SERVER by comparing
 * her recorded final against the proposal's own numbers. Never re-derived in a
 * component: a status computed twice is a status that disagrees with itself.
 */
export type ConsultProposalReviewLineStatusDTO =
  /** She has not recorded anything for this line yet. */
  | 'NOT_REVIEWED'
  /** Recorded, and her numbers match what the client was sold. */
  | 'CONFIRMED'
  /** Recorded, and her price or duration differs from what the client was sold. */
  | 'ADJUSTED'
  /** Recorded with a written concern and no change to the numbers. */
  | 'FLAGGED'

export type ConsultProposalReviewLineDTO = {
  /**
   * The ESTIMATE line this correction is stored against — the row that carries
   * the frozen AI half and the writable pro-final half (B3). It is also this
   * line's identity in a review submission.
   */
  estimateLineId: string
  serviceId: string
  /**
   * The pro's own offering this line was re-derived from — carried so the
   * in-chair finalization (B6) can put the line straight into her consultation
   * proposal, which identifies a base service by offering and not by service.
   */
  offeringId: string
  serviceName: string
  source: ConsultServiceEstimateLineSource
  /**
   * Decision 6's "why": what in the look or the analysis put this line here,
   * copied from the estimate line. Never invented, never re-derived.
   */
  rationale: string
  /** What the client was sold, under HER chosen mode. Decimal string. */
  proposedPrice: string
  /** The width this line reserved in the pro's day, rounded up to her step. */
  proposedDurationMinutes: number
  /** The pro's correction, once recorded. Null until she reviews the line. */
  proFinalPrice: string | null
  proFinalDurationMinutes: number | null
  proFinalNote: string | null
  proFinalAt: string | null
  reviewStatus: ConsultProposalReviewLineStatusDTO
}

export type ConsultProposalReviewDTO = {
  bookingId: string
  consultId: string
  /**
   * Decision 4's pro half: ONE review surface, and the booking's own status
   * decides only WHERE the page puts it. A booking still waiting on her is
   * reviewed BEFORE the accept/decline she already has; one her auto-accept
   * toggle already accepted is reviewed AFTER it.
   *
   * Answered by the server so the placement and the sentence that explains it
   * cannot be decided twice.
   */
  placement: 'BEFORE_DECISION' | 'AFTER_ACCEPTANCE'
  /**
   * Whether corrections may still be recorded. False once the booking has
   * reached a terminal state — there is no longer a day to protect or a price
   * to settle, and a correction recorded then would be a pair about nothing.
   */
  editable: boolean
  /** The mode the client chose; every proposed number below is read from it. */
  locationType: ServiceLocationType
  stepMinutes: number
  bufferMinutes: number
  /** The width this booking reserved: the sum of the proposed line durations. */
  totalDurationMinutes: number
  /** What the client agreed to. Echoed from the stored proposal, never re-derived. */
  startingAtPrice: string
  /** The composed "Starting at $X" label, or null when the total is not positive. */
  startingAtLabel: string | null
  /**
   * The pro's totals, summed on the server from her recorded finals with the
   * proposed number standing in for any line she has not reviewed. Null when she
   * has reviewed nothing at all, so the surface shows no second total rather
   * than one identical to the client's.
   */
  proFinalTotalPrice: string | null
  proFinalTotalDurationMinutes: number | null
  /** The most recent correction on any line, or null when there is none. */
  reviewedAt: string | null
  lines: ConsultProposalReviewLineDTO[]
  /**
   * Book the Look, B7 — decision 10's PRO half: "recommended attach at session
   * close". The enhancements the analysis recommended and this client did NOT
   * take, priced under the mode she booked, so the pro can put one back on the
   * appointment in one tap while the person is in her chair.
   *
   * Empty when the analysis recommended nothing beyond the look, when she took
   * everything, or when a declined line can no longer be priced on the pro's
   * live menu — she cannot attach what she can no longer sell, and a row that
   * 400s on send is worse than no row.
   *
   * ⚠️ PRO-FACING, which is why `serviceName` is on this type and deliberately
   * NOT on the client's `ConsultBookingProposalRecommendationDTO`. Decision 6
   * is that the pro sees her own menu, line by line, with the reason for each;
   * decision 1 is that the CLIENT never sees the taxonomy. Both are true, and
   * these are the two different types that keep them true.
   */
  declinedRecommendations: ConsultProposalDeclinedRecommendationDTO[]
}

/**
 * One enhancement the client declined, as the pro is offered it back (B7).
 *
 * The numbers are RE-DERIVED from her live menu under the booking's own mode —
 * not read off the estimate, whose prices are the salon column (B5, rule 3).
 * They seed her in-chair line item, and she can edit it like any other.
 */
export type ConsultProposalDeclinedRecommendationDTO = {
  /** The estimate line, so the correction pair still lands where B3 put it. */
  estimateLineId: string
  serviceId: string
  /** Her own offering — the in-chair form identifies a BASE service by this. */
  offeringId: string
  serviceName: string
  /** Decision 6's "why", copied from the estimate line. Never invented. */
  rationale: string
  /** Decimal string, under the mode this booking was made in. */
  price: string
  durationMinutes: number
}

export type ConsultProposalReviewResponseDTO = {
  review: ConsultProposalReviewDTO
}

/** One line of a submitted review. Money crosses as a decimal string. */
export type ConsultProposalReviewLineRequestDTO = {
  estimateLineId: string
  price: string
  durationMinutes: number
  /** Her written concern about this line, or null/absent to clear it. */
  note?: string | null
}

export type ConsultProposalReviewRequestDTO = {
  lines: ConsultProposalReviewLineRequestDTO[]
}

export type ConsultProposalReviewErrorCode =
  | 'CONSULT_PROPOSAL_REVIEW_NOT_FOUND'
  | 'CONSULT_PROPOSAL_REVIEW_INVALID_REQUEST'
  | 'CONSULT_PROPOSAL_REVIEW_NOT_EDITABLE'
  | 'CONSULT_PROPOSAL_REVIEW_UNAVAILABLE'

export type ConsultProposalReviewErrorDTO = {
  ok: false
  error: string
  code: ConsultProposalReviewErrorCode
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
  // P4 — what the consult read off the client's inspiration reference. OPTIONAL
  // on the wire for the same reason `serviceEstimate` is: the published schema
  // grows by addition only and shipped iOS fixtures stay valid. Null when the
  // client brought no reference, or when the stored artefact is pinned to a
  // DIFFERENT inspiration revision than this brief — a stale read is the wrong
  // photograph's colour, so the brief shows nothing rather than the wrong thing.
  inspirationAnalysis?: ConsultInspirationAnalysisDTO | null
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
  // The heading the client sees over `recommendationDirections`, resolved
  // from the serving tenant's brand copy (lib/brand). OPTIONAL on the wire —
  // a purely additive field, so shipped native builds (which hardcode the
  // default heading) keep decoding; a build that reads it falls back to its
  // own string when absent. #1068 planned it and dropped it.
  directionsTitle?: string
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
  // P4: the inspiration reference could not be read. UNAVAILABLE is the
  // provider being down or refusing (retry); UNREADABLE is this PHOTO —
  // the model looked and could name nothing, so the client is asked for a
  // clearer one. Neither ever falls back to a static question list.
  | 'CONSULT_INSPIRATION_ANALYSIS_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_ANALYSIS_UNREADABLE'
  | 'CONSULT_LOOK_NOT_CONSULTABLE'

export type ConsultAgreementErrorDTO = {
  ok: false
  error: string
  code: ConsultAgreementErrorCode
}
