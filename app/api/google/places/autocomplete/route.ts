// app/api/google/places/autocomplete/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import {
  getGoogleMapsKey,
  fetchWithTimeout,
  safeJson,
  clampGoogleRadiusMeters,
  assertGoogleOk,
} from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function pickNumber(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const input = pickString(searchParams.get('input'))
    if (!input) return jsonFail(400, 'Missing input.')

    const sessionToken = pickString(searchParams.get('sessionToken'))
    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))
    const radiusMeters = pickNumber(searchParams.get('radiusMeters')) ?? 50_000

    // Optional: bias to US; change/remove if you want global
    const components = pickString(searchParams.get('components')) ?? 'country:us'

    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
    url.searchParams.set('key', getGoogleMapsKey())
    url.searchParams.set('input', input)
    url.searchParams.set('language', 'en')
    url.searchParams.set('components', components)

    if (lat != null && lng != null) {
      url.searchParams.set('location', `${lat},${lng}`)
      url.searchParams.set('radius', String(clampGoogleRadiusMeters(radiusMeters)))
    }

    if (sessionToken) url.searchParams.set('sessiontoken', sessionToken)

    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const data = await safeJson<any>(res)

    if (!res.ok) {
      return jsonFail(502, 'Google request failed.', { details: data })
    }

    const status = String(data?.status ?? '')
    try {
      assertGoogleOk(status, data?.error_message)
    } catch (err: any) {
      return jsonFail(400, err?.message || `Google status: ${status}`, { details: data })
    }

    const predictions = Array.isArray(data?.predictions) ? data.predictions : []

    return jsonOk({
      ok: true,
      predictions: predictions.map((p: any) => ({
        placeId: String(p?.place_id ?? ''),
        description: String(p?.description ?? ''),
        mainText: String(p?.structured_formatting?.main_text ?? ''),
        secondaryText: String(p?.structured_formatting?.secondary_text ?? ''),
        types: Array.isArray(p?.types) ? p.types : [],
      })),
    })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Google request timed out.' : e?.message || 'Internal error'
    console.error('GET /api/google/places/autocomplete error', e)
    return jsonFail(500, msg)
  }
}
