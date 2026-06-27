// lib/clientAddresses/placesAutocomplete.ts
//
// Shared client-side helpers for the Google Places address autocomplete used by
// every service-address entry surface (client settings, client booking modal,
// pro new-booking form). Single source of truth for the prediction/place-detail
// parsing + session token so the forms don't each re-implement it.
//
// These are pure functions (no React) and safe to import from client components.
// They parse the responses from `/api/v1/google/places/autocomplete` and
// `/api/v1/google/places/details`.

import { isRecord } from '@/lib/guards'

export type PlacePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export type PlaceDetails = {
  placeId: string
  name: string | null
  formattedAddress: string
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
  lat: number | null
  lng: number | null
  components: Record<string, string>
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pickNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Opaque per-search session token for Places billing/session grouping. Rotate
 * (call again) after a prediction is chosen.
 */
export function makePlacesSessionToken(): string {
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
}

/** Parse the `/api/v1/google/places/autocomplete` response into predictions. */
export function parsePlacePredictions(raw: unknown): PlacePrediction[] {
  if (!isRecord(raw) || !Array.isArray(raw.predictions)) return []

  return raw.predictions.reduce<PlacePrediction[]>((acc, row) => {
    if (!isRecord(row)) return acc

    const placeId = pickString(row.placeId)
    const description = pickString(row.description)
    if (!placeId || !description) return acc

    acc.push({
      placeId,
      description,
      mainText: pickString(row.mainText) ?? description,
      secondaryText: pickString(row.secondaryText) ?? '',
    })

    return acc
  }, [])
}

/** Parse the `/api/v1/google/places/details` response into normalized place data. */
export function parsePlaceDetails(raw: unknown): PlaceDetails | null {
  if (!isRecord(raw) || !isRecord(raw.place)) return null
  const place = raw.place

  const placeId = pickString(place.placeId)
  const formattedAddress = pickString(place.formattedAddress)

  if (!placeId || !formattedAddress) return null

  const components = isRecord(place.components)
    ? Object.entries(place.components).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (typeof value === 'string' && value.trim()) {
            acc[key] = value.trim()
          }
          return acc
        },
        {},
      )
    : {}

  return {
    placeId,
    name: pickString(place.name),
    formattedAddress,
    city: pickString(place.city),
    state: pickString(place.state),
    postalCode: pickString(place.postalCode),
    countryCode: pickString(place.countryCode),
    lat: pickNumber(place.lat),
    lng: pickNumber(place.lng),
    components,
  }
}
