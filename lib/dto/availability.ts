// lib/dto/availability.ts
//
// Wire DTOs for the availability endpoints (GET /api/v1/availability/*).
//
// `alternates` already has a maintained response type in the booking drawer's
// `types.ts` (the web client decodes that exact shape) and the route now
// enforces it via `satisfies`, so we re-export it here for native codegen.
// `other-pros` was the one endpoint returning an inline literal with no named
// type; its DTO is defined here and enforced at the route via `satisfies`.
//
// NOT yet here: `day` / `bootstrap`. Their route payloads embed an `offering`
// whose price fields are typed `unknown` (raw Prisma.Decimal, serialized to a
// string only implicitly by NextResponse.json), so they cannot `satisfies` the
// drawer's `AvailabilityDayOk` / `AvailabilityBootstrapOk` (which declare
// `string | null`). Publishing them accurately requires serializing the offering
// explicitly at the route — a focused follow-up that touches the shared
// `offeringContext` builder, tracked separately.
//
// All shapes here are JSON-safe (`OtherProRow` is plain primitives + a Prisma
// enum; the alternates shape carries no Decimal/Date).

import type { ServiceLocationType } from '@prisma/client'

import type { OtherProRow } from '@/lib/availability/data/otherPros'

export type { AvailabilityAlternatesOk } from '@/app/(main)/booking/AvailabilityDrawer/types'

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
