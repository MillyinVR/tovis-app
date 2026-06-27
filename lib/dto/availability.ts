// lib/dto/availability.ts
//
// Wire DTOs for the availability endpoints (GET /api/v1/availability/*).
//
// day / bootstrap / alternates have maintained response types in the booking
// drawer's `types.ts` (the web client decodes those exact shapes); each route
// now enforces its `*Ok` type via `satisfies`, so we re-export them here for
// native codegen. day/bootstrap serialize their `offering` to string prices via
// `toAvailabilityOfferingDto` so they satisfy the string-typed contract.
// `other-pros` was the one endpoint returning an inline literal with no named
// type; its DTO is defined here and enforced at the route via `satisfies`.
//
// All shapes here are JSON-safe (`OtherProRow` is plain primitives + a Prisma
// enum; offering prices are stringified; no Decimal/Date reaches the wire type).

import type { ServiceLocationType } from '@prisma/client'

import type { OtherProRow } from '@/lib/availability/data/otherPros'

export type {
  AvailabilityDayOk,
  AvailabilityBootstrapOk,
  AvailabilityAlternatesOk,
} from '@/app/(main)/booking/AvailabilityDrawer/types'

// Echoed-back request descriptor on the other-pros response.
export type AvailabilityOtherProsRequestDTO = {
  professionalId: string
  serviceId: string
  requestedLocationType: ServiceLocationType | null
  requestedLocationId: string | null
  effectiveLocationType: ServiceLocationType
  locationId: string
  clientAddressId: string | null
  viewer: {
    lat: number
    lng: number
    radiusMiles: number
    placeId: string | null
  } | null
  limit: number
}

// GET /api/v1/availability/other-pros success response.
export type AvailabilityOtherProsOk = {
  ok: true
  mode: 'OTHER_PROS'
  availabilityVersion: string
  generatedAt: string
  request: AvailabilityOtherProsRequestDTO
  professionalId: string
  serviceId: string
  locationType: ServiceLocationType
  locationId: string
  timeZone: string
  radiusMiles: number
  usedViewerCenter: boolean
  center: { lat: number; lng: number } | null
  otherPros: OtherProRow[]
}
