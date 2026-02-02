import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function componentMap(addressComponents: any[]) {
  const out: Record<string, string> = {}
  for (const c of addressComponents || []) {
    const types: string[] = Array.isArray(c?.types) ? c.types : []
    const longName = typeof c?.long_name === 'string' ? c.long_name : ''
    const shortName = typeof c?.short_name === 'string' ? c.short_name : ''
    for (const t of types) out[t] = shortName || longName
  }
  return out
}

export async function GET(req: Request) {
  try {
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

    const data = await safeJson<any>(res)
    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    const status = String(data?.status ?? '')
    if (status !== 'OK') {
      return jsonFail(400, data?.error_message || `Google status: ${status}`, { details: data })
    }

    const first = Array.isArray(data?.results) ? data.results[0] : null
    if (!first) return jsonFail(400, 'No results found.')

    const loc = first?.geometry?.location ?? {}
    const lat = typeof loc?.lat === 'number' ? loc.lat : null
    const lng = typeof loc?.lng === 'number' ? loc.lng : null

    const cm = componentMap(Array.isArray(first?.address_components) ? first.address_components : [])

    return jsonOk({
      ok: true,
      geo: {
        lat,
        lng,
        postalCode: cm.postal_code || null,
        city: cm.locality || cm.postal_town || null,
        state: cm.administrative_area_level_1 || null,
        countryCode: cm.country || null,
      },
    })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Google request timed out.' : e?.message || 'Internal error'
    console.error('GET /api/google/geocode error', e)
    return jsonFail(500, msg)
  }
}
