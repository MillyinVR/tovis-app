// app/api/google/places/autocomplete/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson, clampGoogleRadiusMeters } from '@/app/api/_utils'

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

    const components = pickString(searchParams.get('components')) ?? 'country:us'
    const regionCode = components.startsWith('country:')
      ? components.replace('country:', '').toUpperCase()
      : undefined

    const url = 'https://places.googleapis.com/v1/places:autocomplete'

    const body: any = {
      input,
      languageCode: 'en',
    }

    if (sessionToken) body.sessionToken = sessionToken
    if (regionCode) body.regionCode = regionCode

    // Optional: bias results toward the user's area
    if (lat != null && lng != null) {
      body.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: clampGoogleRadiusMeters(radiusMeters),
        },
      }
    }

    // Optional: helps nudge toward address-y results (works well for salon flow)
    // Remove if you want broader suggestions.
    body.includedPrimaryTypes = ['street_address', 'premise', 'subpremise']

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getGoogleMapsKey(),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const data = await safeJson<any>(res)
    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : []

    const predictions = suggestions
      .map((s: any) => s?.placePrediction)
      .filter(Boolean)
      .map((p: any) => {
        const mainText = pickString(p?.structuredFormat?.mainText?.text) ?? ''
        const secondaryText = pickString(p?.structuredFormat?.secondaryText?.text) ?? ''
        const description =
          pickString(p?.text?.text) ?? [mainText, secondaryText].filter(Boolean).join(', ')

        return {
          placeId: String(p?.placeId ?? ''),
          description: String(description ?? ''),
          mainText: String(mainText ?? ''),
          secondaryText: String(secondaryText ?? ''),
          types: Array.isArray(p?.types) ? p.types : [],
        }
      })
      .filter((p: any) => p.placeId && p.description)

    return jsonOk({ ok: true, predictions })
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'Google request timed out.' : e?.message || 'Internal error'
    console.error('GET /api/google/places/autocomplete error', e)
    return jsonFail(500, msg)
  }
}
