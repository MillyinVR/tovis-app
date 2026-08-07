// lib/dto/consult.ts
//
// Wire DTO for the AI Consult Phase 0 foundation. There is no intake, capture,
// or analysis route yet, so this exposes only the required booking anchors and
// explicit consent-first lifecycle state. Sensitive content will come from
// immutable revisions rather than mutable fields on this DTO.

import type { ConsultSessionStatus } from '@prisma/client'

// GET/POST /api/v1/client/consult — the pre-visit AI consult session.
export type ConsultSessionDTO = {
  id: string
  status: ConsultSessionStatus
  bookingId: string
  professionalId: string
  serviceCategoryId: string
  createdAt: string
}
