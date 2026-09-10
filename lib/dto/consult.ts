import type { ConsultLookAdjustment } from '@/lib/consult/lookAdjustments'
// lib/dto/consult.ts
//
// Wire DTO for the AI Consult Phase 0 booking-attached hair-color pilot.
// Sensitive intake content is exposed only through the consent-gated intake
// route and comes from immutable ConsultRevision rows.

import type {
  ConsultAgreementKind,
  ConsultAnalysisRunStage,
  ConsultAnalysisRunStatus,
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
  | 'CHART_FACT'

export type ConsultIntakePrefillProvenanceDTO = {
  source: ConsultIntakePrefillSourceDTO
  sourceId: string | null
  recordedAt?: string
  validUntil?: string | null
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

/**
 * WHICH SERVICE this consult is about (lib/consult/serviceIdentity.ts). The
 * booking's service on a booking anchor, the Look's primary service on a look
 * anchor — the flow is look-based, so before this the client could be asked
 * about "this kind of service" with no service named anywhere on screen
 * (handoff B6).
 *
 * `name` is the plain-language name the CLIENT is shown (the pro's own
 * offering title when they set one); `proFacingName` is the catalog name the
 * pro's menu uses and the analysis recommends from. Every field is nullable
 * together: a Look whose linked service row was deleted names nothing, and a
 * client is told "your consult" rather than the wrong service.
 */
export type ConsultServiceIdentityDTO = {
  serviceId: string | null
  name: string | null
  proFacingName: string | null
}

export type ConsultIntakeStateDTO = {
  chartReview?: ConsultChartReviewOfferDTO

  consultId: string
  status: ConsultSessionStatus
  service: ConsultServiceIdentityDTO
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

/**
 * A guided-inspiration question key.
 *
 * 🔴 WIDENED in P5c, from the seven hair-colour keys to any pack key. The
 * questions are no longer one hard-coded list: each service family serves its
 * own pack (lib/consult/inspiration/), so the key a client echoes back is
 * whatever the server just asked her. Clients must treat it as an opaque
 * string and render the question they were sent — a client that switches on
 * these seven values renders nothing for every family but colour.
 *
 * The seven v1 keys are still served, and are still what a consult that
 * started before P5c is asked:
 *   favorite_colors, avoid_colors, length_goal, fullness_goal,
 *   current_styling, styling_walkthrough, other_detail
 *
 * The widening is a LOOSENING on the wire: every value that validated before
 * still validates, so shipped fixtures and shipped clients keep working.
 */
export type ConsultInspirationQuestionKeyDTO = string

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

/**
 * P5d — which tier a card belongs to. COARSE is the three asked before the
 * booking; PREP is the fine per-attribute cards asked after it.
 */
export type ConsultInspirationCardTierDTO = 'COARSE' | 'PREP'

/**
 * P5g — whether a card is one crop with buttons, or the whole reference with
 * tappable areas drawn on it. See `ConsultInspirationCardDTO.presentation`.
 */
export type ConsultInspirationCardPresentationDTO = 'CROP' | 'REGION_PICKER'

/**
 * One option of a card whose OPTIONS crop to different parts of the reference.
 *
 * The coarse "what made you stop scrolling?" card is the only user today: "the
 * color" and "the shape of it" are two visibly different crops of one
 * photograph, and being able to SEE the difference is what makes the question
 * answerable by someone who has never been asked it before.
 *
 * A null `region` means show the whole reference — either because the option is
 * about the whole picture ("the whole thing"), or because the reading did not
 * settle the attributes that option groups. Both are the same instruction to
 * the client, on purpose: a fallback that looks like a feature.
 */
export type ConsultInspirationCardOptionDTO = {
  value: string
  label: string
  region: ConsultInspirationAnalysisRegionDTO | null
}

/**
 * P5d — an inspiration CARD: a crop of the client's own reference, a plain
 * word for what is in the crop, and a question about it.
 *
 * 🔴 Nothing here is stored. The crop comes from the reading
 * (`ConsultInspirationAnalysisDTO`), the words come from the brand's copy
 * table, and the client's payload holds only the question key and the option
 * enum she tapped. A client renders this; it never composes one.
 *
 * 🔴 A card exists only where the reading saw something. There is no fixed list
 * of cards to fall back to, which is what makes "a light-blonde reference never
 * produces a copper question" structural rather than a rule someone remembered.
 */
export type ConsultInspirationCardDTO = {
  /** The pack question this card asks — what an answer echoes back. */
  questionKey: ConsultInspirationQuestionKeyDTO
  tier: ConsultInspirationCardTierDTO
  /** The reading attribute this card is about, or null for a coarse card. */
  attribute: ConsultInspirationAnalysisFieldDTO | null
  /** That attribute's read value, so the client and the brief agree. */
  attributeValue: string | null
  /**
   * 🔴 The plain-language name, shown UNDER the crop and never above it. Null
   * on a card with no single subject.
   */
  name: string | null
  /** The crop for the card. Null means show the whole reference. */
  region: ConsultInspirationAnalysisRegionDTO | null
  /**
   * P5g — HOW this card is drawn.
   *
   * `CROP` is P5d's card: one crop of the reference (or the whole thing), a
   * plain word under it, and buttons.
   *
   * `REGION_PICKER` is the P5g move: the WHOLE reference with every readable
   * attribute drawn on it as a tappable area, multi-select. `region` is always
   * null on one — the boxes in `optionRegions` are measured against the whole
   * picture, so cropping it would send every box somewhere else.
   *
   * A client that does not know a value renders the card as `CROP`, which is
   * correct rather than merely safe: the question and its options are on the
   * wire either way, so an older build asks the same question with buttons.
   */
  presentation: ConsultInspirationCardPresentationDTO
  /** Per-option crops, when the card's options point at different parts. */
  optionRegions: ConsultInspirationCardOptionDTO[]
  /** The question itself, in the shape the answer route already accepts. */
  question: ConsultInspirationQuestionDTO
  /** What she has already chosen here — the thread's own history. */
  selectedValues: string[]
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
  /**
   * P5b — has this reference been READ by the vision model yet?
   *
   * False means the client should POST to
   * `/api/v1/client/consult/{id}/inspiration/read`, which makes the paid call
   * and stores the artefact. True means it is already stored, and a second
   * POST is free (the request hash matches and no call is made).
   *
   * OPTIONAL on the wire, like `serviceEstimate` and `inspirationAnalysis`
   * before it: the published schema grows by addition only, so the shipped iOS
   * fixtures for `ConsultInspirationStateDTO` stay valid and neither repo has
   * to merge first.
   *
   * 🔴 ABSENT is not `false`. A server that omits it is one that predates the
   * read stage, so it has no `/inspiration/read` route to call either — a
   * client that treated absent as "not read yet" would POST at a 404 on a
   * loop. Absent means "this server has no read stage": do nothing.
   */
  analysisReady?: boolean
}

export type ConsultInspirationReviewDTO = {
  revisionId: string
  revision: number
  schemaVersion: number
  /**
   * P5c — the inspiration PACK this review was written under.
   *
   * `null` for a contract-v1 review, which predates packs: those are the seven
   * hair-colour questions. ABSENT means the SERVER predates P5c and knows
   * nothing about packs at all — treat it exactly like null.
   *
   * OPTIONAL on the wire so the published schema grows by addition only, which
   * is what keeps the shipped iOS fixtures and shipped clients valid.
   */
  packId?: string | null
  packVersion?: number | null
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
    /**
     * P5d — the first unanswered PREP card, once the coarse tier is done.
     *
     * Not the same thing as `currentQuestion`, which is what still blocks
     * completion; a prep card never blocks anything. ABSENT means a server (or
     * a contract-v1 consult) with no prep tier at all.
     */
    nextPrepQuestionKey?: string | null
    answeredQuestionCount: number
    specificDetailCount: number
    /**
     * How many non-neutral details this consult's contract requires before it
     * can complete.
     *
     * 🔴 WIDENED in P5c, from the literal 3 to a number, because contract v2
     * dropped the gate entirely and answers 0. A consult that started on v1
     * still answers 3 and is still gated. A client must render this number
     * rather than the word "three", and must not treat 0 as "unknown".
     */
    requiredSpecificDetailCount: number
    canComplete: boolean
    blocker:
      | 'SOURCE_DECISION_REQUIRED'
      | 'QUESTIONS_REMAINING'
      /** v1 only. Contract v2 has no detail gate, so it never sends this. */
      | 'AT_LEAST_THREE_DETAILS_REQUIRED'
      | null
  }
  /**
   * P5d — every card this client is shown, coarse first then prep, in pack
   * order. Empty for a contract-v1 consult (which has a question wizard, not
   * cards) and for one that brought no reference.
   *
   * OPTIONAL on the wire, like every field added since: the published schema
   * grows by addition only, so shipped fixtures and shipped clients stay valid.
   */
  cards?: ConsultInspirationCardDTO[]
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

/**
 * P5b — what POST `/inspiration/read` answers: the inspiration state, with
 * `source.analysisReady` now true.
 *
 * The READING itself is deliberately not on the wire here. It is a colourist's
 * description of someone else's hair, and the client has no use for the raw
 * enums; what she sees is P5d's cards, built from it server-side. The pro sees
 * it on her brief.
 */
export type ConsultInspirationReadResponseDTO =
  ConsultInspirationStateResponseDTO & {
    /** True when this request made the paid call rather than reusing a stored reading. */
    read: boolean
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
  // P7a-1: the early photo. Stored like any other capture and readable as
  // analysis evidence, but a member of no pack — see
  // lib/consult/capture/earlyPhoto.ts for why.
  | 'early_photo'

/**
 * How much of the world a view asks for, as the CLIENT needs to know it.
 *
 * The gate's own use of this lives server-side (lib/consult/capture/types.ts):
 * it decides whether a colour finding refuses a shot or only warns on it. It is
 * on the wire because the CAMERA needs the same answer for a different reason
 * (P3): a `TIGHT_CROP` shot is composed as an ordinary portrait and then
 * auto-cropped on device to the band the shot actually asks for, while a
 * `FULL_VIEW` shot is uploaded as framed.
 *
 * 🔴 It is served rather than derived from the shot KEY on the client. The key
 * is open by design (a pack added after a build ships still renders and
 * uploads), so a device-side key→framing table would silently stop
 * auto-cropping the first TIGHT_CROP shot of any pack it has not been taught —
 * with no error, no telemetry, and a photograph the gate then refuses for
 * VIEW_MISMATCH. The server is the only place that knows.
 */
export type ConsultCaptureShotFramingDTO = 'FULL_VIEW' | 'TIGHT_CROP'

export type ConsultCaptureShotDTO = {
  key: ConsultCaptureShotKeyDTO
  title: string
  instruction: string
  requirement: 'REQUIRED'
  framing: ConsultCaptureShotFramingDTO
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

// A finding that rode along on an ACCEPTED capture instead of blocking it. A
// warning never blocks the slot: it is stored on the accepted result so the
// analysis, the pro brief and any later audit know what is not fully
// trustworthy about that frame.
//
// WHICH findings may be downgraded is the SHOT's decision, not this type's, and
// the two answers differ (lib/consult/capture/types.ts):
//   - a GUIDED shot downgrades the two colour findings, on every framing
//     (2026-09-07); before that only on a tight crop, where a warm reading is as
//     likely to be the skin as the room (B3);
//   - the WARN_ONLY early photo downgrades everything except
//     `SUBJECT_NOT_VISIBLE`, because it is taken in whatever light is on and is
//     never the colour evidence (P7a-1).
//
// So the union is every reason code a capture can carry EXCEPT 'PASS' — 'PASS'
// is the absence of a finding, and a warning is by definition a finding. The
// narrow per-shot guarantee lives in `sanitizeConsultCaptureQuality` and in the
// database CHECK, both of which key off the shot.
export type ConsultCaptureQualityWarningCodeDTO = Exclude<
  ConsultCaptureQualityReasonCodeDTO,
  'PASS'
>

export type ConsultCaptureSlotStateDTO = {
  shotKey: ConsultCaptureShotKeyDTO
  state: 'EMPTY' | 'UPLOADED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'PURGED'
  captureId: string | null
  qualityReasonCode: ConsultCaptureQualityReasonCodeDTO | null
  qualityWarningCode: ConsultCaptureQualityWarningCodeDTO | null
  retakeTip: string | null
  rawExpiresAt: string | null
  purgedAt: string | null
  /**
   * How many times this slot has been JUDGED — accepted or rejected — for the
   * whole life of the consult. 0 on an empty slot, 1 on a first verdict.
   *
   * On the wire because a second refusal that looks exactly like the first is
   * indistinguishable from nothing having happened. That is not hypothetical:
   * it is what a client reported on 2026-09-07 as "the retake never finished",
   * when in fact all four attempts were judged on their own bytes and refused
   * for the same reason.
   */
  attemptCount: number
  /**
   * The reason the attempt BEFORE this one was refused, if there was one and it
   * was refused. Lets a client say "this one's warm too" without keeping its
   * own history — which it cannot do reliably anyway, since the queue forgets a
   * shot the moment a verdict lands and a reinstall forgets everything.
   *
   * Null when this is the first attempt, when the previous attempt was
   * ACCEPTED, or when the previous attempt's reason is not known.
   */
  previousReasonCode: ConsultCaptureQualityReasonCodeDTO | null
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
  /**
   * P7a-1, the early photo — the one taken at the spark, before any intake.
   *
   * Its own field and deliberately NOT a member of `slots`: `slots` is this
   * pack's guided checklist and drives every "N of M photos" the clients
   * render, so an extra entry there would have read as an extra chore. `null`
   * until she takes one. One accepted early photo is what unlocks the sticky
   * Book CTA (`ConsultThreadBookCtaDTO`).
   */
  earlyPhoto: ConsultCaptureSlotStateDTO | null
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
  /** Absent on analyses saved before schema v5. */
  eyeColor?: ConsultAnalysisObservationDTO<'BROWN' | 'BLUE' | 'GREEN' | 'HAZEL' | 'GRAY' | 'MIXED' | 'UNKNOWN'>
  eyeShape: ConsultAnalysisObservationDTO<ConsultProfileEyeShapeDTO>
  eyeSpacing: ConsultAnalysisObservationDTO<ConsultProfileEyeSpacingDTO>
  browDensity: ConsultAnalysisObservationDTO<ConsultProfileBrowDensityDTO>
  browShape: ConsultAnalysisObservationDTO<ConsultProfileBrowShapeDTO>
}

export type ConsultFaceColorProfileDTO = {
  skinDepth: ConsultAnalysisObservationDTO<'VERY_LIGHT' | 'LIGHT' | 'MEDIUM' | 'DEEP' | 'VERY_DEEP' | 'UNKNOWN'>
  surfaceOvertone: ConsultAnalysisObservationDTO<'BALANCED' | 'VISIBLE_REDNESS' | 'VISIBLE_GOLDEN_CAST' | 'VISIBLE_OLIVE_CAST' | 'UNKNOWN'>
  faceWidthBalance: ConsultAnalysisObservationDTO<'FOREHEAD_DOMINANT' | 'CHEEKBONE_DOMINANT' | 'JAW_DOMINANT' | 'BALANCED' | 'UNKNOWN'>
  chinContour: ConsultAnalysisObservationDTO<'SOFT' | 'TAPERED' | 'BROAD' | 'ANGULAR' | 'UNKNOWN'>
  eyeTilt: ConsultAnalysisObservationDTO<'UPTURNED' | 'LEVEL' | 'DOWNTURNED' | 'UNKNOWN'>
  lidVisibility: ConsultAnalysisObservationDTO<'OPEN' | 'PARTIAL' | 'MINIMAL' | 'DEEP_SET' | 'PROMINENT' | 'UNKNOWN'>
  browBoneRelationship: ConsultAnalysisObservationDTO<'LOW' | 'BALANCED' | 'HIGH' | 'UNKNOWN'>
  browArchPosition: ConsultAnalysisObservationDTO<'INNER' | 'CENTER' | 'OUTER' | 'STRAIGHT' | 'UNKNOWN'>
  browTailDirection: ConsultAnalysisObservationDTO<'LIFTED' | 'LEVEL' | 'DROPPED' | 'UNKNOWN'>
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

export type ConsultLookEstimateAmountDTO = {
  price: string | null
  priceStatus: 'PAID' | 'COMPLIMENTARY' | 'UNSET'
  knownSubtotal: string
  durationMinutes: number | null
}

export type ConsultLookPathEstimateDTO = {
  pathIndex: number
  locationType: ServiceLocationType
  firstAppointment: ConsultLookEstimateAmountDTO
  transformation: ConsultLookEstimateAmountDTO
  visits: Array<ConsultLookEstimateAmountDTO & {
    steps: Array<ConsultLookEstimateAmountDTO & { offeringId: string; serviceId: string; available: boolean }>
  }>
}

export type ConsultLookBriefVersionDTO = {
  chartSources?: ConsultChartSourceDTO[]
  bookingId: string | null
  confirmationOpen: boolean
  completedVisit: ConsultLookCompletedVisitDTO | null
  professionalPlan: ConsultLookPlanDTO | null
  professionalPlanReason: string | null
  invalidatedProfessionalPlan: boolean
  inputOpen: boolean
  additionalClientAnswers: ConsultBriefClientIntakeItemDTO[]
  adjustments: ConsultLookAdjustment[]
  invalidatedAdjustments: ConsultLookAdjustment[]
  awaitingAnalysis: boolean
  changes: string[]

  id: string
  version: number
  sourceAnalysisRevisionId: string
  selectedPathIndex: number | null
  selectedLocationType: ServiceLocationType | null
  clientConfirmed: boolean
  professionalConfirmed: boolean
  pathEstimates: ConsultLookPathEstimateDTO[]
  reservedDurationMinutes: number | null
}

/** A server-resolved hair path. Client surfaces render outcome titles, not step names. */
export type ConsultLookPlanDTO = {
  schemaVersion: 1
  tier: 'EXACT' | 'CLOSE' | 'TOWARD'
  status: 'READY_TO_CHOOSE' | 'NEEDS_INPUT' | 'PRO_REVIEW' | 'NO_OFFERING'
  provisional: boolean
  summary: string
  nextStep: string
  paths: Array<{
    title: string
    whyThisWorksForYou: string
    featureEvidence: Array<`profile.${keyof ConsultAnalysisFeatureProfileDTO}` | `core.${keyof ConsultAnalysisPayloadDTO['core']}`>
    sessionCount: number
    visits: Array<{ steps: Array<{
      serviceId: string
      offeringId: string
      serviceCategoryId: string
      serviceName: string
    }> }>
  }>
}

export type ConsultAnalysisPayloadDTO = {
  /** Present on result-first hair analyses; absent on historical versions. */
  lookPlan?: ConsultLookPlanDTO
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
  /**
   * P4b: the most recent background run, or null when the analysis has never
   * been started. The client polls this endpoint while `run.status` is QUEUED
   * or RUNNING; `result` is what it opens when the run COMPLETES.
   */
  run: ConsultAnalysisRunDTO | null
}

export type ConsultAnalysisStartRequestDTO = {
  idempotencyKey: string
  schemaVersion: number
  promptVersion: string
}

/**
 * P4b: one background analysis run, as the client's waiting screen reads it.
 *
 * `stage` drives the progress copy and `photoCount` fills in the number in it
 * ("reading your 4 photos"). Everything here is either a lifecycle fact or a
 * count — no model output, no failure text: `failureCode` is a code the client
 * maps to its own copy, never a message to render.
 */
export type ConsultAnalysisRunDTO = {
  runId: string
  status: ConsultAnalysisRunStatus
  stage: ConsultAnalysisRunStage
  /** How many of the client's captures this run reads. */
  photoCount: number
  attemptCount: number
  maxAttempts: number
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  /** Set only on FAILED. A code from the consult error vocabulary. */
  failureCode: string | null
  /**
   * Whether POSTing the analysis endpoint again would start a fresh run. True
   * only for a FAILED run — a live run must never be raced by a retry tap,
   * and a COMPLETED one has an artefact to read instead.
   */
  retryable: boolean
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

export type ConsultSuitabilitySourceDTO = {
  id: string
  revisionId: string
  value: string
  provenance: 'CLIENT_REPORTED' | 'OBSERVED'
  confidence?: ConsultAnalysisConfidenceDTO
  evidence?: Array<'image' | 'inspiration' | 'profile' | 'core' | string>
  sentiment?: 'LIKE' | 'DISLIKE' | 'GOAL' | 'CONTEXT'
}

export type ConsultSuitabilityTailoringDirectionDTO = {
  clientExplanation: string
  professionalDirection: string
  status: 'SUPPORTED' | 'NEEDS_PRO_CONFIRMATION'
  provenance: 'DERIVED_GUIDANCE'
  sources: ConsultSuitabilitySourceDTO[]
}

export type ConsultSuitabilityProfessionalConfirmationDTO = {
  clientExplanation: string
  professionalCheck: string
  provenance: 'NEEDS_PRO_CONFIRMATION'
  sources: ConsultSuitabilitySourceDTO[]
}

export type ConsultSuitabilityTranslationDTO = {
  schemaVersion: 1
  promptVersion: string
  requiresProfessionalReview: true
  analysisRevisionId: string
  clientRevisionId: string
  clientSource: 'INTAKE' | 'INSPIRATION'
  whatYouLoved: ConsultSuitabilitySourceDTO[]
  tailoring: ConsultSuitabilityTailoringDirectionDTO[]
  proConfirmations: ConsultSuitabilityProfessionalConfirmationDTO[]
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
 * One of the eight attributes above, by name.
 *
 * P5d: an inspiration CARD is about exactly one of these, and its crop is that
 * attribute's `region`. Named here rather than in the vision module so a pack
 * definition can point at an attribute without importing the provider client.
 */
export type ConsultInspirationAnalysisFieldDTO =
  keyof ConsultInspirationAnalysisAttributesDTO

/**
 * The stored artefact, identified by the inspiration ROW it read: a SWAPPED
 * reference makes this one stale, and the pro brief declines to show a stale
 * one rather than showing the wrong picture's colour.
 *
 * 🔴 It used to be pinned to the guided-inspiration REVISION instead, which
 * made it stale every time the client answered a question about the very same
 * photograph — and made the analysis pay to read that photograph again (P5b).
 */
export type ConsultInspirationAnalysisDTO = {
  revisionId: string
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
  /** Versioned looks use the shared brief editor rather than shared estimate-line corrections. */
  lookBriefHref?: string
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

export type ConsultMentorDTO = {
  title: string
  authority: string
  formulationNote: string
  sections: Array<{ id: number; title: string; items: Array<{ text: string; sourceId: string }> }>
}

export type ConsultProBriefDTO = {
  mentor?: ConsultMentorDTO

  lookBrief?: ConsultLookBriefVersionDTO
  lookPlan?: ConsultLookPlanDTO
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
  profile: ConsultAnalysisFeatureProfileDTO & Partial<ConsultFaceColorProfileDTO>
  styleDirections: ConsultStyleDirectionDTO[]
  safetyFlags: ConsultAnalysisPayloadDTO['safetyFlags']
  achievabilityDirection: ConsultBriefAchievabilityDirectionDTO
  recommendationDirections: ConsultBriefRecommendationDirectionDTO[]
  suitability?: ConsultSuitabilityTranslationDTO
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
  /**
   * P7a-3 — which plan version this brief is, and what changed to get here.
   *
   * OPTIONAL on the wire for the same reason `serviceEstimate` is: the
   * published schema grows by addition only and shipped iOS fixtures stay
   * valid. `planVersion` is 1 for a consult that has never been reworked, and
   * `planChanges` is then empty — there is nothing before it to differ from.
   *
   * 🔴 The diff is against the PREVIOUS version, not against the pro's own
   * adjustments. Carrying those forward is P10's job and is a different
   * question; this one answers "what did your client change since you last
   * looked?".
   */
  planVersion?: number
  planChanges?: ConsultPlanDiffEntryDTO[]
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

/**
 * The colour-reliability tally behind the plan's rule-8 line. Counts, not a
 * verdict: the sentence names them ("4 of your 5 photos"), and a client can
 * check that against what she remembers taking.
 */
export type ConsultResultsPhotoLightDTO = {
  /** Accepted captures that fed the analysis. */
  acceptedFrameCount: number
  /** How many of those carried a colour warning (warm light or a cast). */
  warmFrameCount: number
  /**
   * Whether MOST of them did — strictly more than half, and at least one.
   * Decided here so the two clients cannot disagree about what "most" means.
   */
  mostFramesWarm: boolean
}

export type ConsultClientResultsDTO = {
  lookBrief?: ConsultLookBriefVersionDTO
  lookPlan?: ConsultLookPlanDTO
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
  suitability?: ConsultSuitabilityTranslationDTO
  // The heading the client sees over `recommendationDirections`, resolved
  // from the serving tenant's brand copy (lib/brand). OPTIONAL on the wire —
  // a purely additive field, so shipped native builds (which hardcode the
  // default heading) keep decoding; a build that reads it falls back to its
  // own string when absent. #1068 planned it and dropped it.
  directionsTitle?: string
  /**
   * What the LIGHT in her photographs means for the colour reading — rule 8:
   * the consult says what it could not see rather than filling the gap.
   *
   * Warm light stopped refusing a photo on 2026-09-07, so a plan can now be
   * built from frames the old gate would have turned away. That is the right
   * trade — a blocked client learns nothing — but only if the plan SAYS so
   * when the light was against it. The analysis already widens its confidence
   * on a warned frame; this is the same fact in the client's own words.
   *
   * OPTIONAL on the wire, so the cross-repo fixture contract stays a pure
   * addition and a native build that predates it keeps decoding
   * (tools/check-ios-fixture-contract.mjs).
   */
  photoLight?: ConsultResultsPhotoLightDTO
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
  | 'CONSULT_ANALYSIS_TRANSACTION_EXPIRED'
  | 'CONSULT_INSPIRATION_SCHEMA_VERSION_MISMATCH'
  | 'CONSULT_INSPIRATION_LOOK_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_SOURCE_REQUIRED'
  | 'CONSULT_INSPIRATION_SOURCE_UNAVAILABLE'
  | 'CONSULT_INSPIRATION_UPLOAD_EXPIRED'
  | 'CONSULT_INSPIRATION_UPLOAD_MISMATCH'
  | 'CONSULT_INSPIRATION_OBJECT_INVALID'
  // P2e. The reference could not be decoded or brought inside the vision
  // envelope — a 422 whose one useful action is a different picture.
  | 'CONSULT_INSPIRATION_IMAGE_UNREADABLE'
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
  // P7a-3. The consult stayed open after its analysis completed; what closes
  // it is the APPOINTMENT. These four are the ends of that longer life.
  | 'CONSULT_APPOINTMENT_STARTED'
  | 'CONSULT_ANALYSIS_PHOTOS_EXPIRED'
  | 'CONSULT_ANALYSIS_RERUN_LIMIT_REACHED'
  | 'CONSULT_ANALYSIS_SUPERSEDED'

export type ConsultAgreementErrorDTO = {
  ok: false
  error: string
  code: ConsultAgreementErrorCode
}

// ─────────────────────────────────────────────────────────────────────────────
// P5a — the consult THREAD projection.
//
// "The consult is a chat" (handoff Part 2, Tori 2026-09-05). The thread is
// SCRIPTED BY THE SERVER FLOW STATE, not free-text LLM chat: every prompt is a
// tappable card, so it is deterministic, instant, and free per message.
//
// This is a PROJECTION and nothing else. It adds no state, owns no writes and
// changes no contract — every payload below is an existing DTO from this file,
// re-emitted in thread order. The stage endpoints keep serving exactly what
// they serve today; this is the same information, ordered, in ONE read, so
// resume is a read rather than client-side bookkeeping and the ordering rule
// lives in one place instead of once per client.
//
// 🔴 The mutation routes are unchanged and remain the ONLY way to answer
// anything here. A thread message is a rendering of state, never an authority
// over it — the client still POSTs to the same intake/inspiration/capture/
// analysis endpoints, and re-reads the thread afterwards.

/**
 * Who a message is from.
 *
 * `APP` is the app's own voice — warm, short, and never impersonating the pro
 * (handoff: "the pro is the recipient of the Brief"). `CLIENT` is the client's
 * own answer echoed back into the thread as history.
 */
export type ConsultThreadAuthorDTO = 'APP' | 'CLIENT'

/**
 * Whether a message is still awaiting the client, or is settled history.
 *
 * 🔴 SEVERAL messages can be `OPEN` at once, and that is not a bug: the
 * inspiration review and the photo pack are genuinely concurrent server-side —
 * she can answer either, in either order — so marking one of them `BLOCKED`
 * would be a lie about what the server will accept. `BLOCKED` means a step that
 * really cannot be acted on yet.
 *
 * Where to RESUME is `ConsultThreadDTO.nextOpenMessageId`, which names the FIRST
 * open message in thread order. That is a served field rather than something
 * each client re-derives from four progress blockers.
 */
export type ConsultThreadMessageStateDTO = 'DONE' | 'OPEN' | 'BLOCKED'

/** A system text bubble. Its wording comes from the brand copy table. */
export type ConsultThreadTextMessageDTO = {
  kind: 'TEXT'
  id: string
  author: ConsultThreadAuthorDTO
  state: ConsultThreadMessageStateDTO
  text: string
}

/**
 * The consent prerequisites, in the thread rather than in front of it.
 *
 * Not one of the handoff's six message types, and deliberately included: the
 * flow is unreachable without it, and a consult whose consent was revoked
 * resumes HERE. Leaving it outside the thread would make "reopening resumes at
 * the next open step" false for exactly the client who most needs it.
 */
export type ConsultThreadConsentMessageDTO = {
  kind: 'CONSENT'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  text: string
  requirements: ConsultAgreementRequirementDTO[]
}

/**
 * One intake question, one message (handoff: "one per message"). `answer` is
 * what the client has already chosen — present on a `DONE` message, null on the
 * `OPEN` one.
 */
export type ConsultThreadQuestionMessageDTO = {
  chartFactSourceId?: string
  chartReviewFingerprint?: string

  kind: 'QUESTION'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  question: ConsultIntakeQuestionDTO
  answer: string | null
  /**
   * The pack this question belongs to. Carried because answering it POSTs a
   * whole intake revision pinned to these versions — a thread that rendered the
   * question but made the client go and fetch the version to answer it would
   * not be "one read".
   */
  packVersion: number
  schemaVersion: number
}

/**
 * The inspiration step as a card.
 *
 * P5a renders the CURRENT v1 questions; P5 replaces the content with the
 * zoom-card script (a crop of the attribute's region + "is this part of what
 * you like?"). The card shape is what P5a is fixing in place, not the wording.
 *
 * `sourceDecisionRequired` is the state before any reference exists at all —
 * the client either adds one photo or continues without.
 */
export type ConsultThreadInspirationMessageDTO = {
  kind: 'INSPIRATION'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  /**
   * 🔴 NULLABLE since P5d. The step's own bubble belongs to the message that
   * asks for a reference; a CARD says its piece on the card itself, and a
   * bubble above every one of eleven cards would be eleven sentences nobody
   * asked for. Clients render the bubble only when there is one.
   */
  text: string | null
  sourceDecisionRequired: boolean
  source: ConsultInspirationSourceStateDTO | null
  question: ConsultInspirationQuestionDTO | null
  /**
   * P5d — the card this message IS, when it is one.
   *
   * Additive and optional on the wire: a client that predates cards keeps
   * rendering `question` and simply shows no crop, which is the same thing it
   * shows a client whose reference could not be read. `question` is carried
   * alongside deliberately — answering has not changed, and a card that made
   * its own answer route would be a second write path to keep in step.
   */
  card?: ConsultInspirationCardDTO | null
  answeredQuestionCount: number
  specificDetailCount: number
  requiredSpecificDetailCount: number
  /** The version every inspiration mutation must echo. */
  schemaVersion: number
}

/**
 * A photo request — the message that opens the guided (P2d) camera and comes
 * back as a thumbnail carrying its own badge.
 *
 * 🔴 `slot` is the SERVED capture slot, unchanged. The Uploading → Checking →
 * Passed / Retake badge is resolved on the CLIENT, because the durable upload
 * queue knows about a shot the server has not been told about yet and must
 * outrank the served state. That rule already ships in both clients and is
 * lifted into this message, never re-derived here.
 */
export type ConsultThreadPhotoRequestMessageDTO = {
  chartPhotos?: ConsultChartPhotoDTO[]
  kind: 'PHOTO_REQUEST'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  shot: ConsultCaptureShotDTO
  /** The versions the upload / attach / quality calls must echo. */
  shotPackVersion: number
  schemaVersion: number
  /**
   * The served slot. Always present — the server serves an EMPTY slot for every
   * shot in the pack from the start, so the client never has to invent a
   * placeholder for "not taken yet".
   */
  slot: ConsultCaptureSlotStateDTO
  /**
   * May this shot be taken RIGHT NOW? (P3b.)
   *
   * 🔴 This is not `state`, and the difference is the point. `state: BLOCKED`
   * means "not the place resume lands" — a blocked photo request is
   * deliberately still tappable on both clients, which is how she jumps
   * between guided shots and how she retakes one after her plan exists. Gating
   * the camera on BLOCKED would take both of those away.
   *
   * `shootable` answers the other question: would the SERVER accept this
   * upload? It is derived from `guidedCaptureWritable` /`earlyPhotoWritable`
   * — the same predicates the write boundary itself uses — so a request can
   * never be offered on a client and refused on the server again, which is
   * exactly what happened on Tori's phone on 2026-09-06.
   *
   * Optional on the wire: a client that predates it treats a request as
   * shootable, which is the behaviour it already had.
   */
  shootable?: boolean
}

/**
 * The plan card — the reveal.
 *
 * P5a is the PLACEHOLDER the handoff asks for: it renders the existing analysis
 * result when one is present, the live run while one is going, and the invitation
 * to start one before that. The versioned plan-card content is later work.
 */
export type ConsultThreadPlanMessageDTO = {
  kind: 'PLAN'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  text: string
  /** Present while a background run is live or has failed (P4b). */
  run: ConsultAnalysisRunDTO | null
  /** Present once the analysis has committed a result. */
  results: ConsultClientResultsDTO | null
  /** True when the client has to start the run herself (ANALYSIS_PENDING). */
  awaitingStart: boolean
  /** The versions the start-analysis call must echo. Null once it has run. */
  schemaVersion: number | null
  promptVersion: string | null
  /**
   * P7a-3: which plan version `results` is. 1 for the first analysis, 2 after
   * the first rerun. Zero while none exists.
   *
   * 🔴 OPTIONAL on the wire, like `serviceEstimate` and `inspirationAnalysis`
   * before it, and for a reason that is not cosmetic: the generator marks a
   * required field REQUIRED, and tovis-ios CI validates its fixtures against
   * this repo's schema on `main`. A required field here reddens iOS main the
   * instant this merges — and since the same change adds a new message KIND
   * (which cannot validate against the OLD schema either), the two repos
   * deadlock: neither can land first. Optional breaks the cycle, and it is the
   * convention every field added since P5a already follows.
   *
   * The server always sends both.
   */
  planVersion?: number
  /**
   * P7a-3: an input changed after this version was built, so a new one is
   * coming. The card says so instead of showing a plan the client already knows
   * is out of date. Optional on the wire for the reason above.
   */
  updatePending?: boolean
}

/**
 * P7a-3 — "your plan changed, and here is what changed".
 *
 * One bubble per version after the first. It carries the DIFF rather than the
 * new plan: the plan card above already shows the current version, and a client
 * scrolling back needs to know what moved, not to read the whole thing again.
 *
 * 🔴 `changes` is empty on a rerun that produced the same answer, and the copy
 * says so. A rerun that changes nothing is a real and reassuring outcome —
 * "we looked again and it still holds" — and hiding it would make the thread
 * look like it ignored her edit.
 */
export type ConsultThreadPlanUpdateMessageDTO = {
  kind: 'PLAN_UPDATE'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  text: string
  /** The version this bubble announces. Always >= 2. */
  planVersion: number
  /** The version it is being compared against. */
  previousPlanVersion: number
  changes: ConsultPlanDiffEntryDTO[]
  createdAt: string
}

/**
 * One line of a plan diff, in the client's language.
 *
 * `label` is the thing that changed ("Sessions", "What we'd do first"), `from`
 * and `to` are its values. Never a field path: this is read by a person in bed
 * at eleven at night, not by an engineer reading a changelog.
 */
export type ConsultPlanDiffEntryDTO = {
  key: string
  label: string
  from: string | null
  to: string | null
}

/**
 * The booking confirmation, and everything after it is prep.
 *
 * 🔴 `bookingId` non-null is what makes the rest of the thread read as "help
 * <pro> get ready" rather than as a consult still trying to sell an appointment.
 */
export type ConsultThreadBookingMessageDTO = {
  kind: 'BOOKING'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  text: string
  bookingId: string
}

/**
 * P5g — one adaptive follow-up question, as a card in the thread.
 *
 * 🔴 `text` on this message is the only prose in the consult a MODEL wrote and
 * a client reads. It is generated per client from the reference reading, her
 * own photo reading, the regions she tapped and every answer so far, and it
 * must name something specific it saw — a question that would be the same for
 * everybody is the question P5g exists to delete.
 *
 * 🔴 `options` are enums from a vocabulary that already exists
 * (lib/consult/followUpVocabulary.ts), re-worded by the model but never
 * invented: a value outside the key's real options throws the whole round away
 * on the server, so a client can echo any of these back and know it will file.
 *
 * `fallback` is true when the model call failed and these are the intake pack's
 * OWN remaining safety questions instead. It is on the wire because the client
 * says so out loud ("couldn't think of the next question — here are the
 * essentials"): Part 0 rule 4 forbids a silent fallback, and a fallback the
 * client cannot see is a silent one.
 */
export type ConsultThreadFollowUpMessageDTO = {
  chartFactSourceId?: string
  kind: 'FOLLOW_UP'
  id: string
  author: 'APP'
  state: ConsultThreadMessageStateDTO
  /** The question itself. */
  text: string
  questionKey: string
  options: ConsultInspirationQuestionOptionDTO[]
  /** What she chose, or empty while it is open — the thread's own history. */
  selectedValues: string[]
  fallback: boolean
  /** Which round of at most three this is, for the client's own ordering. */
  round: number
}

export type ConsultThreadMessageDTO =
  | ConsultThreadTextMessageDTO
  | ConsultThreadConsentMessageDTO
  | ConsultThreadQuestionMessageDTO
  | ConsultThreadInspirationMessageDTO
  | ConsultThreadPhotoRequestMessageDTO
  | ConsultThreadPlanMessageDTO
  | ConsultThreadPlanUpdateMessageDTO
  | ConsultThreadBookingMessageDTO
  | ConsultThreadFollowUpMessageDTO

/**
 * Why the sticky Book the look button is not live yet.
 *
 * `SELFIE_REQUIRED` is the ordinary one: the handoff unlocks booking "once one
 * selfie is in", so the gate is the face_front slot being accepted (a WARNED
 * shot is an accepted shot — `qualityWarningCode` is only ever set on one).
 */
export type ConsultThreadBookGateReasonDTO =
  | 'LOOK_CHOICE_REQUIRED'
  | 'SELFIE_REQUIRED'
  | 'ALREADY_BOOKED'
  | 'NOT_LOOK_ANCHORED'
  | 'CONSULT_STOPPED'
  | 'LOOK_NOT_BOOKABLE'
  /**
   * P7a-5. This pro asks clients in this service category to finish the safety
   * questions before taking a slot (`ProCategoryBookingPolicy.bookingGate`).
   *
   * 🔴 Unlike the others this one is TEMPORARY BY DESIGN — the client can clear
   * it herself, in this same thread, by answering. So the button stays visible
   * and disabled with `gateNote` under it, and both clients must keep it in
   * their "show, disabled" branch rather than their "hide" branch. Hiding it
   * would remove the only thing telling her what to do next.
   */
  | 'PREP_REQUIRED'

/**
 * The sticky CTA's state, decided by the SERVER so the two clients cannot
 * disagree about when the spark is bookable.
 *
 * 🔴 `enabled` deliberately does NOT wait for the analysis. Booking here runs
 * the ORDINARY look-booking path (handoff: "instant; analysis is ~100s and
 * cannot gate the spark"), which is why this carries the look's own service and
 * media rather than a consult proposal: the consult-proposal path refuses with
 * ESTIMATE_MISSING until the analysis commits an estimate, and that refusal
 * stays exactly as it is.
 */
export type ConsultThreadBookCtaDTO = {
  /** New plans enter the proposal flow rather than the reference-service spark. */
  proposalConsultId?: string
  enabled: boolean
  reason: ConsultThreadBookGateReasonDTO | null
  /** The look this consult is anchored to. Null on a booking-anchored consult. */
  lookPostId: string | null
  /** The look's linked service — what the ordinary booking path books. */
  serviceId: string | null
  /** The look's primary media, so the booking sheet's cover is the photo she tapped. */
  lookMediaId: string | null
  /**
   * P7a-5 — the money line under the button: "From $180 · $25 deposit".
   *
   * 🔴 COMPOSED ON THE SERVER, rendered verbatim, exactly like the thread's
   * bubbles (lib/consult/threadCopy.ts). Two separate numbers on the wire would
   * be two numbers each client joins by hand, which is how the same look came
   * to read "From $249.5" in the feed and "From $250" everywhere else before
   * `formatLookStartingPrice` consolidated it.
   *
   * 🔴 A PERCENT deposit renders as a percentage ("20% deposit"), never as a
   * dollar figure. The percentage is taken of the service subtotal, which needs
   * a location mode and any add-ons — none of them chosen at the spark — so a
   * dollar amount here would be a guess presented as a promise.
   *
   * Null when there is no price to show and no charge to disclose. The deposit
   * half appears only when `resolveDepositRequirement` says this booking really
   * would owe one, so the CTA and the charge cannot disagree.
   */
  priceNote: string | null
  /**
   * P7a-5 — why the button is dark, in the pro's own name, when the reason is
   * `PREP_REQUIRED`. Null for every other reason.
   *
   * Server-composed because it carries the pro's display name, and a `{pro}`
   * slot filled on the device would be the second implementation of a
   * substitution this repo deliberately does once (`fillConsultThreadCopy`).
   * The two older notes stay client-side: they carry no slots, and both clients
   * already mirror them.
   */
  gateNote: string | null
}

export type ConsultThreadControlsDTO = {
  inputsOpen: boolean
  canEditAnswers: boolean
  canDelete: boolean
  revokeAcceptanceId: string | null
}

export type ConsultThreadDTO = {
  /** Optional for compatibility with older cached threads. Mutations remain authoritative. */
  controls?: ConsultThreadControlsDTO

  consultId: string
  status: ConsultSessionStatus
  /** The consult's professional, and her public display name (honors nameDisplay). */
  professionalId: string
  professionalDisplayName: string
  /**
   * The FIRST message still awaiting the client, or null when nothing is.
   * Reopening a consult scrolls here — this is the "next open step" in one read.
   * Other messages may also be `OPEN` (see `ConsultThreadMessageStateDTO`);
   * this is the one to land on.
   */
  nextOpenMessageId: string | null
  messages: ConsultThreadMessageDTO[]
  book: ConsultThreadBookCtaDTO
  /**
   * The keep-these-photos-on-my-chart choice (decision 2026-08-26). Present
   * only while the capture step is readable, which is the only window in which
   * it can still be changed. Not a message: it is a standing preference the
   * client can flip at any point in that window, not a step she answers once.
   */
  chartCopy: ConsultChartCopyStateDTO | null
}

export type ConsultThreadResponseDTO = {
  thread: ConsultThreadDTO
}

/** Content-free Home list; private answers and photos stay behind the consult. */
export type ClientConsultSessionsDTO = {
  consultations: Array<{
    id: string
    lookPostId: string
    professionalId: string
    professionalName: string | null
    updatedAt: string
    canResume: boolean
  }>
  nextCursor: string | null
}

/** Short-lived authorized media reads; storage paths never cross the wire. */
export type ConsultLookBriefPhotosDTO = {
  captures: Array<{ id: string; label: string; url: string }>
  inspirationUrl: string | null
  expiresInSeconds: number
}

export type ConsultLookCompletedVisitDTO = {
  bookingId: string
  lookBriefVersionId: string
  observedServiceMinutes: number | null
  finalServiceSubtotal: string | null
  completedAt: string
  aftercare: { notes: string | null; sections: Array<{ label: string; body: string }>; products: Array<{ name: string; note: string | null }> } | null
}

export type ConsultChartReviewOfferDTO = {
  fingerprint: string
  lastVisitAt: string
  facts: Array<{ questionKey: string; label: string; value: string; answer: string; recordedAt: string }>
}

export type ConsultChartSourceDTO = {
  questionKey: string
  recordedAt: string
  confirmedAt: string
  summary: string
}

export type ConsultChartPhotoDTO = {
  mediaAssetId: string
  url: string
  label: string
  recordedAt: string
}
