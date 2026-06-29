// lib/dto/clientAddress.ts
//
// Wire (output) shape for a client's saved address:
//   GET  /api/v1/client/addresses        → { addresses: ClientAddressDTO[] }
//   POST /api/v1/client/addresses        → { address: ClientAddressDTO }
//   GET/PATCH /api/v1/client/addresses/[id]
//
// A SERVICE_ADDRESS is where a MOBILE booking is performed (carries geocoded
// lat/lng so the pro's travel-radius check can run); a SEARCH_AREA is a saved
// discovery origin. House rule: Prisma is the single source of truth — this DTO
// is the serialized projection of `mapClientAddress` (Decimal lat/lng → number,
// Date → ISO string).
import type { ClientAddressKind } from '@prisma/client'

export type ClientAddressDTO = {
  id: string
  kind: ClientAddressKind
  label: string | null
  isDefault: boolean
  formattedAddress: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  createdAt: string // ISO-8601
  updatedAt: string // ISO-8601
}
