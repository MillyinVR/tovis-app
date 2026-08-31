// lib/consult/mapConsultSession.ts
//
// Single mapping choke point from a BOOKING-ANCHORED ConsultSession row to the
// wire DTO (lib/dto/consult.ts), shared by the create and get routes so the two
// never drift on what a consult session looks like on the wire.
//
// Returns null for a look-anchored consult (Book the Look, B2) rather than
// widening ConsultSessionDTO.bookingId: shipped iOS builds decode that field as
// a non-optional String, and both routes that use this mapper are keyed BY a
// bookingId, so they can never legitimately be handed one. Look-anchored
// consults have their own DTO and mapper in lib/consult/lookConsultEntry.ts.

import type { ConsultSession } from '@prisma/client'
import type { ConsultSessionDTO } from '@/lib/dto/consult'

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
