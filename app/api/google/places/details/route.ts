// app/api/google/places/details/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function componentMap(addressComponents: any[]) {
  const out: Record<string, string> = {}
  for (const c of addressComponents || []) {
    const types: string[] = Array.isArray(c?.types) ? c.types : []
    const longName = typeof c?.long_name === 'string' ? c.long_name : ''
    const shortName = typeof c?.short_name === 'string' ? c.short_name : ''
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

    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
    url.searchParams.set('key', getGoogleMapsKey())
    url.searchParams.set('place_id', placeId)
    url.searchParams.set(
      'fields',
      ['place_id', 'name', 'formatted_address', 'geometry/location', 'address_component', 'types'].join(','),
    )
    url.searchParams.set('language', 'en')
    if (sessionToken) url.searchParams.set('sessiontoken', sessionToken)

    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const data = await safeJson<any>(res)

    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    const status = String(data?.status ?? '')
    if (status !== 'OK') {
      return jsonFail(400, data?.error_message || `Google status: ${status}`, { details: data })
    }

    const r = data?.result ?? {}
    const loc = r?.geometry?.location ?? {}
    const lat = typeof loc?.lat === 'number' ? loc.lat : null
    const lng = typeof loc?.lng === 'number' ? loc.lng : null

    const comps = Array.isArray(r?.address_components) ? r.address_components : []
    const cm = componentMap(comps)

    const city = cm.locality || cm.postal_town || cm.sublocality || null
    const state = cm.administrative_area_level_1 || null
    const postalCode = cm.postal_code || null
    const countryCode = cm.country || null

    return jsonOk({
      ok: true,
      place: {
        placeId: String(r?.place_id ?? placeId),
        name: typeof r?.name === 'string' ? r.name : null,
        formattedAddress: typeof r?.formatted_address === 'string' ? r.formatted_address : null,
        lat,
        lng,
        components: cm,
        city,
        state,
        postalCode,
        countryCode,
        types: Array.isArray(r?.types) ? r.types : [],
      },
    })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Google request timed out.' : e?.message || 'Internal error'
    console.error('GET /api/google/places/details error', e)
    return jsonFail(500, msg)
  }
}
