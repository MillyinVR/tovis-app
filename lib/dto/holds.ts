// lib/dto/holds.ts
//
// Wire DTOs for the BookingHold endpoints (POST /api/v1/holds, GET/DELETE
// /api/v1/holds/[id]). The success envelope's `ok: true` is added by jsonOk and
// is not part of these shapes (same convention as the other response DTOs).
//
// Dates are ISO strings on the wire — the GET path already serializes via
// toHoldDto; the POST path serializes its raw `expiresAt`/`scheduledFor` at the
// return site (these DTOs declare `string`, enforced via `satisfies`).

import type { Prisma, ServiceLocationType } from '@prisma/client'

// GET /api/v1/holds/[id] — full hold view (includes expiry + location snapshot).
export type BookingHoldDTO = {
  id: string
  scheduledFor: string // ISO-8601
  expiresAt: string // ISO-8601
  expired: boolean
  professionalId: string
  offeringId: string
  locationType: ServiceLocationType
  locationId: string | null
  locationTimeZone: string | null
  locationAddressSnapshot: Prisma.JsonValue | null
  locationLatSnapshot: number | null
  locationLngSnapshot: number | null
}

// POST /api/v1/holds — newly created hold (a different projection than GET:
// carries the client address it was placed against, not the location snapshot).
export type BookingHoldCreateDTO = {
  id: string
  expiresAt: string // ISO-8601
  scheduledFor: string // ISO-8601
  locationType: ServiceLocationType
  locationId: string
  locationTimeZone: string | null
  clientAddressId: string | null
  clientAddressSnapshot: Prisma.JsonValue | null
  /**
   * Minutes actually RESERVED — base service + any `addOnIds` sent with the
   * create — excluding the location's buffer. Finalize enforces the same
   * arithmetic, so this is what the slot is being held for (B1-A).
   */
  durationMinutes: number
}

// PATCH /api/v1/holds/[id] — re-size a live hold to a new add-on selection.
// `expiresAt` is echoed unchanged: re-sizing never restarts the hold's clock.
export type BookingHoldAddOnsUpdateDTO = {
  id: string
  scheduledFor: string // ISO-8601
  expiresAt: string // ISO-8601
  durationMinutes: number
  endsAt: string // ISO-8601 — reserved end, buffer included
}

// Shared create/release mutation metadata.
export type MutationMetaDTO = {
  mutated: boolean
  noOp: boolean
}

export type BookingHoldGetResponseDTO = {
  hold: BookingHoldDTO
}

export type BookingHoldCreateResponseDTO = {
  hold: BookingHoldCreateDTO
  meta: MutationMetaDTO
}

export type BookingHoldDeleteResponseDTO = {
  deleted: boolean
  holdId: string
  meta: MutationMetaDTO
}

export type BookingHoldAddOnsUpdateResponseDTO = {
  hold: BookingHoldAddOnsUpdateDTO
  meta: MutationMetaDTO
}
