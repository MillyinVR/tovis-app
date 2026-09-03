// lib/consult/mapConsultSession.ts
//
// Single mapping choke point from a ConsultSession row to its wire DTO
// (lib/dto/consult.ts). A consult is anchored to EITHER a booking OR a look
// (Book the Look, B2), and the two anchors have deliberately separate DTOs
// rather than one with a nullable `bookingId`: shipped iOS builds decode
// `ConsultSession.bookingId` as a non-optional String, and the booking-keyed
// routes they read (#1016) must keep that exact shape.
//
// `toConsultSessionDTO` (booking) and `toConsultLookSessionDTO` (look) each
// return null for the OTHER anchor, so a booking-keyed route can never hand
// out a look consult by accident and vice versa. `toConsultSessionLookupDTO`
// is for the one route keyed by the consult's OWN id (GET .../consult/[id]),
// which legitimately serves both — before it existed that route reused the
// booking mapper and answered `consult: null` for every look-anchored consult,
// which is what the web consult page crashed on straight after Book.

import type { ConsultSession, Prisma } from '@prisma/client'
import type {
  ConsultLookSessionDTO,
  ConsultSessionDTO,
  ConsultSessionLookupDTO,
} from '@/lib/dto/consult'

export function toConsultSessionDTO(
  row: ConsultSession,
): ConsultSessionDTO | null {
  if (!row.bookingId) return null
  return {
    id: row.id,
    status: row.status,
    bookingId: row.bookingId,
    professionalId: row.professionalId,
    serviceCategoryId: row.serviceCategoryId,
    createdAt: row.createdAt.toISOString(),
  }
}

export const CONSULT_LOOK_SESSION_SELECT = {
  id: true,
  status: true,
  anchorLookPostId: true,
  professionalId: true,
  serviceCategoryId: true,
  createdAt: true,
} satisfies Prisma.ConsultSessionSelect

export type ConsultLookSessionRow = Prisma.ConsultSessionGetPayload<{
  select: typeof CONSULT_LOOK_SESSION_SELECT
}>

export function toConsultLookSessionDTO(
  row: ConsultLookSessionRow,
): ConsultLookSessionDTO | null {
  if (!row.anchorLookPostId) return null
  return {
    id: row.id,
    status: row.status,
    lookPostId: row.anchorLookPostId,
    professionalId: row.professionalId,
    serviceCategoryId: row.serviceCategoryId,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * The DTO for a consult looked up by its own id, whichever anchor it has. A
 * booking anchor wins when both are somehow set (the write paths never do
 * that). Null only for a row with NEITHER anchor, which no write path creates.
 */
export function toConsultSessionLookupDTO(
  row: ConsultSession,
): ConsultSessionLookupDTO | null {
  return toConsultSessionDTO(row) ?? toConsultLookSessionDTO(row)
}
