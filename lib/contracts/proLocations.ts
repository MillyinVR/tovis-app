// lib/contracts/proLocations.ts
import { isRecord } from '@/lib/guards'
import { pickBool, pickNumber, pickString, pickStringOrEmpty } from '@/lib/pick'

export type LocationType = 'SALON' | 'SUITE' | 'MOBILE_BASE'

export type ProLocation = {
  id: string
  type: LocationType
  name: string | null
  isPrimary: boolean
  isBookable: boolean

  formattedAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  placeId: string | null

  lat: number | null
  lng: number | null
  timeZone: string | null
  createdAt: string
}

export type PickedPlace = {
  placeId: string | null
  formattedAddress: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  lat: number | null
  lng: number | null
  name?: string | null
  sessionToken?: string | null
}

function readString(v: unknown): string {
  return pickStringOrEmpty(v)
}

function readNullableString(v: unknown): string | null {
  return pickString(v)
}

function readBool(v: unknown): boolean {
  return pickBool(v) ?? false
}

function readNullableNumber(v: unknown): number | null {
  return pickNumber(v)
}

export function parseLocationType(v: unknown): LocationType {
  const s = readString(v).toUpperCase()
  if (s === 'SALON') return 'SALON'
  if (s === 'SUITE') return 'SUITE'
  if (s === 'MOBILE_BASE') return 'MOBILE_BASE'
  return 'SALON'
}

export function parsePickedPlace(v: unknown): PickedPlace | null {
  if (!isRecord(v)) return null
  return {
    placeId: readNullableString(v.placeId),
    formattedAddress: readNullableString(v.formattedAddress),
    city: readNullableString(v.city),
    state: readNullableString(v.state),
    postalCode: readNullableString(v.postalCode),
    countryCode: readNullableString(v.countryCode),
    lat: readNullableNumber(v.lat),
    lng: readNullableNumber(v.lng),
    name: readNullableString(v.name),
    sessionToken: readNullableString(v.sessionToken),
  }
}

export function parseProLocationsPayload(v: unknown): ProLocation[] {
  if (!isRecord(v)) return []
  const raw = v.locations
  if (!Array.isArray(raw)) return []

  const out: ProLocation[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = readString(item.id)
    if (!id) continue

    out.push({
      id,
      type: parseLocationType(item.type),
      name: readNullableString(item.name),
      isPrimary: readBool(item.isPrimary),
      isBookable: readBool(item.isBookable),

      formattedAddress: readNullableString(item.formattedAddress),
      city: readNullableString(item.city),
      state: readNullableString(item.state),
      postalCode: readNullableString(item.postalCode),
      countryCode: readNullableString(item.countryCode),
      placeId: readNullableString(item.placeId),

      lat: readNullableNumber(item.lat),
      lng: readNullableNumber(item.lng),
      timeZone: readNullableString(item.timeZone),

      createdAt: readString(item.createdAt) || new Date().toISOString(),
    })
  }

  return out
}