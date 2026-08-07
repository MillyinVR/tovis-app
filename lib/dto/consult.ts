// lib/dto/consult.ts
//
// Wire DTO for the AI Consult Phase 0 foundation. There is no intake, capture,
// or analysis route yet, so this exposes only the required booking anchors and
// explicit consent-first lifecycle state. Sensitive content will come from
// immutable revisions rather than mutable fields on this DTO.

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

export type ConsultAgreementErrorCode =
  | 'CONSULT_NOT_FOUND'
  | 'CONSULT_AGREEMENTS_UNAVAILABLE'
  | 'CONSULT_AGREEMENT_VERSION_MISMATCH'
  | 'CONSULT_INVALID_STATE'
  | 'CONSULT_ACCEPTANCE_ALREADY_REVOKED'
  | 'CONSULT_INVALID_REQUEST'

export type ConsultAgreementErrorDTO = {
  ok: false
  error: string
  code: ConsultAgreementErrorCode
}
