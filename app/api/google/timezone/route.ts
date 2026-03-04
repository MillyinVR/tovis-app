// app/api/google/timezone/route.ts
import { isRecord } from '@/lib/guards'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import {
  fetchWithTimeout,
  getGoogleMapsKey,
  jsonFail,
  jsonOk,
  pickNumber,
  pickString,
  safeJson,
} from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function isAbortError(e: unknown) {
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    typeof (e as { name: unknown }).name === 'string' &&
    (e as { name: string }).name === 'AbortError'
  )
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

    const data = await safeJson<unknown>(res)
    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    if (!isRecord(data)) return jsonFail(502, 'Invalid Google response.', { details: data })

    const status = pickString(data.status) ?? ''
    if (status !== 'OK') {
      const msg =
        pickString(data.errorMessage) ??
        pickString((data as Record<string, unknown>)['error_message']) ??
        `Google status: ${status}`

      return jsonFail(400, msg, { details: data })
    }

    const timeZoneId = pickString(data.timeZoneId)
    if (!timeZoneId) return jsonFail(400, 'No timeZoneId returned.', { details: data })

    // Defensive: don’t accept garbage
    if (!isValidIanaTimeZone(timeZoneId)) {
      return jsonFail(400, 'Invalid timeZoneId returned.', { timeZoneId, details: data })
    }

    return jsonOk({ ok: true, timeZoneId })
  } catch (e: unknown) {
    const msg = isAbortError(e) ? 'Google request timed out.' : e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/google/timezone error', e)
    return jsonFail(500, msg)
  }
}