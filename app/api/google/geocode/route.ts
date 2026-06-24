// app/api/google/geocode/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  getGoogleMapsKey,
  fetchWithTimeout,
  safeJson,
  enforceGoogleProxyRateLimit,
} from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type GoogleAddressComponent = {
  long_name?: unknown
  short_name?: unknown
  types?: unknown
}

type GoogleGeocodeResult = {
  address_components?: unknown
  geometry?: {
    location?: {
      lat?: unknown
      lng?: unknown
    }
  }
}

type GoogleGeocodeResponse = {
  status?: unknown
  error_message?: unknown
  results?: unknown
}

function componentMap(addressComponents: GoogleAddressComponent[]) {
  const out: Record<string, string> = {}

  for (const component of addressComponents) {
    const types = Array.isArray(component.types)
      ? component.types.filter((type): type is string => typeof type === 'string')
      : []

    const longName =
      typeof component.long_name === 'string' ? component.long_name : ''

    const shortName =
      typeof component.short_name === 'string' ? component.short_name : ''

    for (const type of types) {
      out[type] = shortName || longName
    }
  }

  return out
}

function isGoogleAddressComponent(value: unknown): value is GoogleAddressComponent {
  return typeof value === 'object' && value !== null
}

function isGoogleGeocodeResult(value: unknown): value is GoogleGeocodeResult {
  return typeof value === 'object' && value !== null
}

function getErrorMessage(data: GoogleGeocodeResponse, fallback: string): string {
  return typeof data.error_message === 'string' && data.error_message.trim()
    ? data.error_message
    : fallback
}

export async function GET(req: Request) {
  try {
    const limited = await enforceGoogleProxyRateLimit()
    if (limited) return limited

    const { searchParams } = new URL(req.url)

    const postalCode = pickString(searchParams.get('postalCode'))
    if (!postalCode) return jsonFail(400, 'Missing postalCode.')

    const components = pickString(searchParams.get('components')) ?? 'country:us'

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
    url.searchParams.set('key', getGoogleMapsKey())
    url.searchParams.set('address', postalCode)
    url.searchParams.set('components', components)

    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const data = await safeJson<GoogleGeocodeResponse>(res)

    if (!res.ok) {
      return jsonFail(502, 'Google request failed.', { details: data })
    }

    const status = typeof data.status === 'string' ? data.status : ''

    if (status !== 'OK') {
      return jsonFail(400, getErrorMessage(data, `Google status: ${status}`), {
        details: data,
      })
    }

    const results = Array.isArray(data.results) ? data.results : []
    const firstRaw = results[0]

    if (!isGoogleGeocodeResult(firstRaw)) {
      return jsonFail(400, 'No results found.')
    }

    const loc = firstRaw.geometry?.location ?? {}
    const lat = typeof loc.lat === 'number' ? loc.lat : null
    const lng = typeof loc.lng === 'number' ? loc.lng : null

    const addressComponents = Array.isArray(firstRaw.address_components)
      ? firstRaw.address_components.filter(isGoogleAddressComponent)
      : []

    const cm = componentMap(addressComponents)

    const resolvedPostal = cm.postal_code || null
    if (!resolvedPostal) {
      return jsonFail(400, 'Could not resolve a valid postal code.')
    }

    return jsonOk({
      ok: true,
      geo: {
        lat,
        lng,
        postalCode: resolvedPostal,
        city: cm.locality || cm.postal_town || null,
        state: cm.administrative_area_level_1 || null,
        countryCode: cm.country || null,
      },
    })
  } catch (error: unknown) {
    const msg =
      error instanceof Error && error.name === 'AbortError'
        ? 'Google request timed out.'
        : error instanceof Error
          ? error.message
          : 'Internal error'

    console.error('GET /api/google/geocode error', error)
    return jsonFail(500, msg)
  }
}