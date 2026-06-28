// lib/dto/offeringAddOns.ts
//
// Wire (output) shapes for the offering add-ons surface:
//   GET /api/v1/offerings/add-ons → OfferingAddOnsResponseDTO
//
// Selectable add-ons for an offering in a given location mode. The client renders
// these as toggles in the booking flow and sends the selected `id`s back as
// `addOnIds` on POST /api/v1/bookings/finalize.
//
// House rule: Prisma is the single source of truth for data shapes. These DTOs
// derive from the `OfferingAddOn` link + its `addOnService` via the route mapper
// (Decimal prices → formatted strings), so they are JSON-safe wire shapes.
import type { ServiceLocationType } from '@prisma/client'

export type OfferingAddOnItemDTO = {
  /** OfferingAddOn link id — the value to send back in finalize's `addOnIds`. */
  id: string
  /** The underlying add-on service id (not what finalize wants — use `id`). */
  serviceId: string
  title: string
  /** Add-on grouping label (e.g. "Color"), or null when ungrouped. */
  group: string | null
  /** Formatted money string (e.g. "25.00"). */
  price: string
  minutes: number
  sortOrder: number
  isRecommended: boolean
}

export type OfferingAddOnsServiceDTO = {
  id: string
  name: string
}

export type OfferingAddOnsProfessionalDTO = {
  id: string
  businessName: string | null
}

export type OfferingAddOnsOfferingDTO = {
  id: string
  service: OfferingAddOnsServiceDTO | null
  professional: OfferingAddOnsProfessionalDTO | null
}

export type OfferingAddOnsResponseDTO = {
  offeringId: string
  locationType: ServiceLocationType
  offering: OfferingAddOnsOfferingDTO
  addOns: OfferingAddOnItemDTO[]
}
