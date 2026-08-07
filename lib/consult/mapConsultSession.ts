// lib/consult/mapConsultSession.ts
//
// Single mapping choke point from a ConsultSession row to the wire DTO
// (lib/dto/consult.ts), shared by the create and get routes so the two never
// drift on what a consult session looks like on the wire.

import type { ConsultSession } from '@prisma/client'
import type { ConsultSessionDTO } from '@/lib/dto/consult'

export function toConsultSessionDTO(row: ConsultSession): ConsultSessionDTO {
  return {
    id: row.id,
    status: row.status,
    bookingId: row.bookingId,
    professionalId: row.professionalId,
    serviceCategoryId: row.serviceCategoryId,
    createdAt: row.createdAt.toISOString(),
  }
}
