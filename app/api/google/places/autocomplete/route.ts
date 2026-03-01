// app/api/google/places/autocomplete/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson, clampGoogleRadiusMeters } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function pickNumber(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

type Kind = 'ADDRESS' | 'AREA' | 'ANY'

function normalizeKind(v: string | null): Kind {
  const s = (v || '').trim().toUpperCase()
  if (s === 'ADDRESS') return 'ADDRESS'
  if (s === 'AREA') return 'AREA'
  if (s === 'ANY') return 'ANY'
  // ✅ Default to ANY so callers that forget kind don't break cities/landmarks
  return 'ANY'
}

function isUsZip(input: string) {
  return /^\d{5}(?:-\d{4})?$/.test(input.trim())
}

function normalizeCountryCode(raw: string | null): string {
  const s = (raw || '').trim().toLowerCase().replace(/[^a-z]/g, '')
  // ccTLD/ISO-ish 2-letter. If invalid, default US.
  return s.length === 2 ? s : 'us'
}

function includedPrimaryTypesFor(kind: Kind, zipLike: boolean): string[] | undefined {
  if (kind === 'ANY') return undefined

  if (kind === 'ADDRESS') {
    // 5 max. Keep strictly “address/premise-ish”.
    return ['street_address', 'premise', 'subpremise', 'route', 'intersection']
  }

  // kind === 'AREA'
  if (zipLike) return ['postal_code']

  // 5 max. City/state/neighborhood-ish.
  return ['locality', 'administrative_area_level_1', 'neighborhood', 'sublocality', 'postal_code']
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

function pickText(v: unknown): string {
  return typeof v === 'string' ? v : ''
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

    // keep “components=country:us” compat
    const components = pickString(searchParams.get('components')) ?? 'country:us'
    const cc = components.startsWith('country:') ? components.replace('country:', '') : 'us'
    const country = normalizeCountryCode(cc)

    const kindParam = normalizeKind(pickString(searchParams.get('kind')))
    const zipLike = isUsZip(input)

    // ZIP always behaves as AREA regardless of caller intent
    const kind: Kind = zipLike ? 'AREA' : kindParam

    const url = 'https://places.googleapis.com/v1/places:autocomplete'

    const body: Record<string, unknown> = {
      input,
      languageCode: 'en',
      includedRegionCodes: [country],
      regionCode: country,
      includeQueryPredictions: false,
    }

    if (sessionToken) body.sessionToken = sessionToken

    if (lat != null && lng != null) {
      const clamped = clampGoogleRadiusMeters(radiusMeters)
      body.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: clamped,
        },
      }
      // If origin is provided, the API can return distanceMeters.
      body.origin = { latitude: lat, longitude: lng }
    }

    const types = includedPrimaryTypesFor(kind, zipLike)
    if (types) body.includedPrimaryTypes = types

    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getGoogleMapsKey(),
        // Keeps payload predictable + small
        'X-Goog-FieldMask': [
          'suggestions.placePrediction.placeId',
          'suggestions.placePrediction.text.text',
          'suggestions.placePrediction.structuredFormat',
          'suggestions.placePrediction.types',
          'suggestions.placePrediction.distanceMeters',
        ].join(','),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const data = await safeJson<unknown>(res)
    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })

    const suggestions = isRecord(data) && Array.isArray((data as any).suggestions) ? ((data as any).suggestions as unknown[]) : []

    const predictions = suggestions
      .map((s) => (isRecord(s) ? (s as any).placePrediction : null))
      .filter((p): p is Record<string, unknown> => isRecord(p))
      .map((p) => {
        const placeId = pickText(p.placeId)
        const sf = isRecord(p.structuredFormat) ? (p.structuredFormat as any) : null
        const mainText = sf && isRecord(sf.mainText) ? pickText(sf.mainText.text) : ''
        const secondaryText = sf && isRecord(sf.secondaryText) ? pickText(sf.secondaryText.text) : ''

        const textObj = isRecord(p.text) ? (p.text as any) : null
        const description = pickText(textObj?.text) || [mainText, secondaryText].filter(Boolean).join(', ')

        const typesArr = Array.isArray(p.types) ? p.types.filter((x) => typeof x === 'string') : []
        const distanceMeters = typeof (p as any).distanceMeters === 'number' ? ((p as any).distanceMeters as number) : null

        return {
          placeId,
          description,
          mainText,
          secondaryText,
          types: typesArr,
          distanceMeters,
        }
      })
      .filter((p) => p.placeId && p.description)

    return jsonOk({ kind, predictions })
  } catch (e: unknown) {
    const msg = e instanceof DOMException && e.name === 'AbortError' ? 'Google request timed out.' : e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/google/places/autocomplete error', e)
    return jsonFail(500, msg)
  }
}