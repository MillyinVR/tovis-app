// lib/dto/consult.ts
//
// Wire DTO for the AI Consult Phase 0 booking-attached hair-color pilot.
// Sensitive intake content is exposed only through the consent-gated intake
// route and comes from immutable ConsultRevision rows.

import type {
  ConsultAgreementKind,
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

export type ConsultIntakeQuestionRequirementDTO = 'REQUIRED' | 'SKIPPABLE'

export type ConsultIntakeQuestionOptionDTO = {
  value: string
  label: string
}

export type ConsultIntakeQuestionDTO = {
  key: string
  label: string
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
  | 'CONSULT_IDEMPOTENCY_CONFLICT'
  | 'CONSULT_BOOKING_INELIGIBLE'

export type ConsultAgreementErrorDTO = {
  ok: false
  error: string
  code: ConsultAgreementErrorCode
}
