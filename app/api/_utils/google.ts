// app/api/_utils/google.ts

/**
 * Shared Google API helpers.
 * Single source of truth for Google Maps / Places / Timezone calls.
 */

const DEFAULT_TIMEOUT_MS = 8000
const MIN_GOOGLE_RADIUS_METERS = 1
const MAX_GOOGLE_RADIUS_METERS = 200_000

export function getGoogleMapsKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim()

  if (!key) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY')
  }

  return key
}

/**
 * Safely parse JSON without throwing.
 *
 * Default is `unknown` on purpose:
 * callers should narrow the response shape instead of letting `any`
 * leak through the codebase like a tiny haunted fog machine.
 */
export async function safeJson<T = unknown>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    return {} as T
  }
}

/**
 * Fetch with abort timeout.
 *
 * AbortController.signal is passed into fetch so the controller can abort
 * the request if Google hangs or takes too long.
 */
export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Clamp Google radius values safely.
 */
export function clampGoogleRadiusMeters(value: number): number {
  if (!Number.isFinite(value)) return MIN_GOOGLE_RADIUS_METERS

  return Math.max(
    MIN_GOOGLE_RADIUS_METERS,
    Math.min(MAX_GOOGLE_RADIUS_METERS, Math.trunc(value)),
  )
}

/**
 * Normalize Google API status handling.
 *
 * OK means usable results.
 * ZERO_RESULTS is not a request failure; it just means Google found nothing.
 */
export function assertGoogleOk(
  status: string,
  errorMessage?: string | null,
): void {
  if (status === 'OK' || status === 'ZERO_RESULTS') return

  throw new Error(errorMessage || `Google status: ${status}`)
}

export type GooglePlaceDetails = {
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

export type GooglePostalGeocode = {
  lat: number | null
  lng: number | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function componentMap(addressComponents: unknown): Record<string, string> {
  const out: Record<string, string> = {}

  if (!Array.isArray(addressComponents)) return out

  for (const item of addressComponents) {
    if (!isRecord(item)) continue

    const typesRaw = item.types
    const types = Array.isArray(typesRaw)
      ? typesRaw.filter((type): type is string => typeof type === 'string')
      : []

    const longName = typeof item.long_name === 'string' ? item.long_name : ''
    const shortName = typeof item.short_name === 'string' ? item.short_name : ''
    const value = (shortName || longName).trim()

    if (!value) continue

    for (const type of types) {
      out[type] = value
    }
  }

  return out
}

// Places API (New) returns components as { longText, shortText, types },
// unlike the legacy long_name/short_name shape used by the Geocoding API.
function componentMapV1(addressComponents: unknown): Record<string, string> {
  const out: Record<string, string> = {}

  if (!Array.isArray(addressComponents)) return out

  for (const item of addressComponents) {
    if (!isRecord(item)) continue

    const typesRaw = item.types
    const types = Array.isArray(typesRaw)
      ? typesRaw.filter((type): type is string => typeof type === 'string')
      : []

    const longName = typeof item.longText === 'string' ? item.longText : ''
    const shortName = typeof item.shortText === 'string' ? item.shortText : ''
    const value = (shortName || longName).trim()

    if (!value) continue

    for (const type of types) {
      out[type] = value
    }
  }

  return out
}

function readDisplayNameText(displayName: unknown): string | null {
  if (typeof displayName === 'string') return displayName.trim() || null
  if (!isRecord(displayName)) return null

  const text = displayName.text

  return typeof text === 'string' ? text.trim() || null : null
}

export async function googlePlaceDetails(
  placeId: string,
  sessionToken?: string | null,
): Promise<GooglePlaceDetails> {
  // Legacy maps/api/place/details is rejected for newer API keys; this
  // uses Places API (New), same as the /api/google/places proxy routes.
  const trimmed = placeId.trim()
  const name = trimmed.startsWith('places/') ? trimmed : `places/${trimmed}`
  const url = `https://places.googleapis.com/v1/${encodeURI(name)}`

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Goog-Api-Key': getGoogleMapsKey(),
      // FieldMask is required by Places API (New)
      'X-Goog-FieldMask': [
        'id',
        'displayName',
        'formattedAddress',
        'location',
        'addressComponents',
      ].join(','),
      ...(sessionToken ? { 'X-Goog-Session-Token': sessionToken } : {}),
    },
    cache: 'no-store',
  })

  const data = await safeJson<unknown>(res)

  if (!isRecord(data)) throw new Error('Google response malformed.')

  if (!res.ok) {
    const error = isRecord(data.error) ? data.error : {}

    throw new Error(
      typeof error.message === 'string' && error.message.trim()
        ? error.message
        : 'Google request failed.',
    )
  }

  const location = isRecord(data.location) ? data.location : {}

  const lat = typeof location.latitude === 'number' ? location.latitude : null
  const lng =
    typeof location.longitude === 'number' ? location.longitude : null
  const components = componentMapV1(data.addressComponents)

  return {
    placeId: typeof data.id === 'string' ? data.id : trimmed,
    name: readDisplayNameText(data.displayName),
    formattedAddress:
      typeof data.formattedAddress === 'string' ? data.formattedAddress : null,
    lat,
    lng,
    city:
      components.locality ||
      components.postal_town ||
      components.sublocality ||
      components.sublocality_level_1 ||
      components.neighborhood ||
      null,
    state: components.administrative_area_level_1 || null,
    postalCode: components.postal_code || null,
    countryCode: components.country || null,
  }
}

export async function googleTimeZoneId(
  lat: number,
  lng: number,
): Promise<string> {
  const url = new URL('https://maps.googleapis.com/maps/api/timezone/json')

  url.searchParams.set('key', getGoogleMapsKey())
  url.searchParams.set('location', `${lat},${lng}`)
  url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)))

  const res = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  const data = await safeJson<unknown>(res)

  if (!res.ok) throw new Error('Google request failed.')
  if (!isRecord(data)) throw new Error('Google response malformed.')

  const status = String(data.status ?? '')

  if (status !== 'OK') {
    throw new Error(
      String(
        data.errorMessage ?? data.error_message ?? `Google status: ${status}`,
      ),
    )
  }

  const timeZone = typeof data.timeZoneId === 'string' ? data.timeZoneId : null

  if (!timeZone) throw new Error('No timeZoneId returned.')

  return timeZone
}

export async function googleGeocodePostal(
  postalCode: string,
): Promise<GooglePostalGeocode> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')

  url.searchParams.set('key', getGoogleMapsKey())
  url.searchParams.set('address', postalCode)
  url.searchParams.set('components', 'country:us')

  const res = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  const data = await safeJson<unknown>(res)

  if (!res.ok) throw new Error('Google request failed.')
  if (!isRecord(data)) throw new Error('Google response malformed.')

  const status = String(data.status ?? '')

  if (status !== 'OK') {
    throw new Error(String(data.error_message ?? `Google status: ${status}`))
  }

  const first =
    Array.isArray(data.results) && isRecord(data.results[0])
      ? data.results[0]
      : null

  if (!first) throw new Error('No results found.')

  const geometry = isRecord(first.geometry) ? first.geometry : {}
  const location = isRecord(geometry.location) ? geometry.location : {}

  const lat = typeof location.lat === 'number' ? location.lat : null
  const lng = typeof location.lng === 'number' ? location.lng : null
  const components = componentMap(first.address_components)

  return {
    lat,
    lng,
    city: components.locality || components.postal_town || null,
    state: components.administrative_area_level_1 || null,
    postalCode: components.postal_code || null,
    countryCode: components.country || null,
  }
}