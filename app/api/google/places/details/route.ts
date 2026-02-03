// app/api/google/places/details/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

/**
 * Places API (New): Place Details
 * GET https://places.googleapis.com/v1/places/{placeId}
 * Requires FieldMask header.
 */
function componentMapFromAddressComponents(addressComponents: any[] | undefined) {
  const out: Record<string, string> = {}
  for (const c of addressComponents || []) {
    const types: string[] = Array.isArray(c?.types) ? c.types : []
    const longName = typeof c?.longText === 'string' ? c.longText : ''
    const shortName = typeof c?.shortText === 'string' ? c.shortText : ''
    for (const t of types) {
      if (!t) continue
      out[t] = shortName || longName
    }
  }
  return out
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const placeId = pickString(searchParams.get('placeId'))
    if (!placeId) return jsonFail(400, 'Missing placeId.')

    const sessionToken = pickString(searchParams.get('sessionToken'))

    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Goog-Api-Key': getGoogleMapsKey(),
        // FieldMask is REQUIRED by Places API (New)
        'X-Goog-FieldMask': [
          'id',
          'displayName',
          'formattedAddress',
          'location',
          'addressComponents',
          'types',
        ].join(','),
        ...(sessionToken ? { 'X-Goog-Session-Token': sessionToken } : {}),
      },
      cache: 'no-store',
    })

    const data = await safeJson<any>(res)
    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    // New API fields
    const loc = data?.location ?? {}
    const lat = typeof loc?.latitude === 'number' ? loc.latitude : null
    const lng = typeof loc?.longitude === 'number' ? loc.longitude : null

    const formattedAddress = typeof data?.formattedAddress === 'string' ? data.formattedAddress : null
    const name =
      typeof data?.displayName?.text === 'string'
        ? data.displayName.text
        : typeof data?.displayName === 'string'
          ? data.displayName
          : null

    const cm = componentMapFromAddressComponents(Array.isArray(data?.addressComponents) ? data.addressComponents : [])

    // Match your previous “legacy” keys as best as possible
    const city = cm.locality || cm.postal_town || cm.sublocality || null
    const state = cm.administrative_area_level_1 || null
    const postalCode = cm.postal_code || null
    const countryCode = cm.country || null

    return jsonOk({
      ok: true,
      place: {
        placeId: String(data?.id ?? placeId),
        name,
        formattedAddress,
        lat,
        lng,
        components: cm,
        city,
        state,
        postalCode,
        countryCode,
        types: Array.isArray(data?.types) ? data.types : [],
      },
    })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Google request timed out.' : e?.message || 'Internal error'
    console.error('GET /api/google/places/details error', e)
    return jsonFail(500, msg)
  }
}
