// lib/dto/consult.ts
//
// Wire DTO for the AI Consult pilot (docs/design/ai-consult.md, Phase 0). C1
// ships schema + a create/get route skeleton only — no intake, capture, or
// analysis yet — so this DTO carries just the session's identity and
// lifecycle status. Intake answers / media / analysis / brief fields land on
// this DTO as later build-plan steps (C2-C7) wire them up.

import type { ConsultSessionStatus } from '@prisma/client'

// GET/POST /api/v1/client/consult — the pre-visit AI consult session.
export type ConsultSessionDTO = {
  id: string
  status: ConsultSessionStatus
  bookingId: string | null
  professionalId: string | null
  serviceCategoryId: string | null
  createdAt: string
}
