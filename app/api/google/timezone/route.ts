// app/api/google/timezone/route.ts
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function pickNumber(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))
    if (lat == null || lng == null) return jsonFail(400, 'Missing lat/lng.')

    const url = new URL('https://maps.googleapis.com/maps/api/timezone/json')
    url.searchParams.set('key', getGoogleMapsKey())
    url.searchParams.set('location', `${lat},${lng}`)
    url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)))

    const res = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })

    const data = await safeJson<any>(res)

    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    const status = String(data?.status ?? '')
    if (status !== 'OK') {
      return jsonFail(400, data?.errorMessage || data?.error_message || `Google status: ${status}`, { details: data })
    }

    const timeZoneId = typeof data?.timeZoneId === 'string' ? data.timeZoneId : null
    if (!timeZoneId) return jsonFail(400, 'No timeZoneId returned.')

    return jsonOk({ ok: true, timeZoneId })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Google request timed out.' : e?.message || 'Internal error'
    console.error('GET /api/google/timezone error', e)
    return jsonFail(500, msg)
  }
}
