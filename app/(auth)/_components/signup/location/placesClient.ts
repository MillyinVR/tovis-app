// app/(auth)/_components/signup/location/placesClient.ts
//
// The Google lookups a signup form makes to turn what someone typed into a
// place: autocomplete + place details for a salon address, geocode for a ZIP,
// and the timezone for whichever coordinates come back.
//
// These lived twice — once in SignupProClient and once in SignupClientClient,
// where the ZIP pair had drifted into reading `res.json()` raw instead of
// `safeJsonRecord`. A third copy was about to be written for the social
// completion form, which is what finally made them worth sharing.

import { isRecord } from '@/lib/guards'
import { isUsZip } from '@/lib/usPostalCode'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'

// Re-exported so the two location hooks keep importing their Google helpers and
// their ZIP check from one module; the check itself is lib/usPostalCode's.
export { isUsZip }

export type GooglePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export type PlaceDetails = {
  placeId: string
  name: string | null
  formattedAddress: string | null
  lat: number | null
  lng: number | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
}

export type GeocodedPostal = {
  lat: number
  lng: number
  postalCode: string
  city: string | null
  state: string | null
  countryCode: string | null
}


function readString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function readNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

export async function fetchAutocomplete(args: {
  input: string
  sessionToken: string
}): Promise<GooglePrediction[]> {
  const url = new URL('/api/v1/google/places/autocomplete', 'http://localhost')
  url.searchParams.set('input', args.input)
  url.searchParams.set('sessionToken', args.sessionToken)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) {
    throw new Error(readErrorMessage(data) ?? 'Location search failed.')
  }

  const predsRaw =
    data && Array.isArray(data.predictions) ? data.predictions : []
  const out: GooglePrediction[] = []

  for (const p of predsRaw) {
    if (!isRecord(p)) continue

    const placeId = typeof p.placeId === 'string' ? p.placeId.trim() : ''
    const description =
      typeof p.description === 'string' ? p.description.trim() : ''
    if (!placeId || !description) continue

    out.push({
      placeId,
      description,
      mainText: typeof p.mainText === 'string' ? p.mainText : '',
      secondaryText: typeof p.secondaryText === 'string' ? p.secondaryText : '',
    })
  }

  return out
}

export async function fetchPlaceDetails(args: {
  placeId: string
  sessionToken: string
}): Promise<PlaceDetails> {
  const url = new URL('/api/v1/google/places/details', 'http://localhost')
  url.searchParams.set('placeId', args.placeId)
  url.searchParams.set('sessionToken', args.sessionToken)

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) {
    throw new Error(
      readErrorMessage(data) ?? 'Could not confirm selected location.',
    )
  }

  const place = data && isRecord(data.place) ? data.place : null

  return {
    placeId: readString(place?.placeId) ?? args.placeId,
    name: readString(place?.name),
    formattedAddress: readString(place?.formattedAddress),
    lat: readNumber(place?.lat),
    lng: readNumber(place?.lng),
    city: readString(place?.city),
    state: readString(place?.state),
    postalCode: readString(place?.postalCode),
    countryCode: readString(place?.countryCode),
  }
}

export async function fetchGeocodeByPostal(args: {
  postalCode: string
}): Promise<GeocodedPostal> {
  const url = new URL('/api/v1/google/geocode', 'http://localhost')
  url.searchParams.set('postalCode', args.postalCode)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) throw new Error(readErrorMessage(data) ?? 'ZIP lookup failed.')

  const geo = data && isRecord(data.geo) ? data.geo : null
  const lat = readNumber(geo?.lat)
  const lng = readNumber(geo?.lng)
  const postalCode = readString(geo?.postalCode)

  if (lat == null || lng == null) {
    throw new Error('ZIP lookup returned no coordinates.')
  }
  if (!postalCode) {
    throw new Error('ZIP lookup did not resolve a valid postal code.')
  }

  return {
    lat,
    lng,
    postalCode,
    city: readString(geo?.city),
    state: readString(geo?.state),
    countryCode: readString(geo?.countryCode),
  }
}

export async function fetchTimeZoneId(args: {
  lat: number
  lng: number
}): Promise<string> {
  const url = new URL('/api/v1/google/timezone', 'http://localhost')
  url.searchParams.set('lat', String(args.lat))
  url.searchParams.set('lng', String(args.lng))

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) {
    throw new Error(readErrorMessage(data) ?? 'Timezone lookup failed.')
  }

  const tz = typeof data?.timeZoneId === 'string' ? data.timeZoneId.trim() : ''
  if (!tz) throw new Error('No timezone returned.')
  return tz
}
