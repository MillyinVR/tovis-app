// app/api/google/places/autocomplete/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson, clampGoogleRadiusMeters } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type Kind = 'ADDRESS' | 'AREA' | 'ANY'

type JsonObject = Record<string, unknown>

type Prediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
  types: string[]
  distanceMeters: number | null
}

function isRecord(x: unknown): x is JsonObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickNumber(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pickText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function pickTextOrEmpty(obj: unknown, key: string): string {
  if (!isRecord(obj)) return ''
  return pickText(obj[key])
}

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
  const cleaned = (raw || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  // ISO-ish 2-letter. If invalid, default US.
  return cleaned.length === 2 ? cleaned : 'US'
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

function readSuggestionsArray(data: unknown): unknown[] {
  if (!isRecord(data)) return []
  const s = data['suggestions']
  return Array.isArray(s) ? s : []
}

function readPlacePrediction(suggestion: unknown): JsonObject | null {
  if (!isRecord(suggestion)) return null
  const pp = suggestion['placePrediction']
  return isRecord(pp) ? pp : null
}

function readStructuredFormat(pp: JsonObject): JsonObject | null {
  const sf = pp['structuredFormat']
  return isRecord(sf) ? sf : null
}

function readTextObj(pp: JsonObject): JsonObject | null {
  const t = pp['text']
  return isRecord(t) ? t : null
}

function readTypes(pp: JsonObject): string[] {
  const raw = pp['types']
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

function readDistanceMeters(pp: JsonObject): number | null {
  const v = pp['distanceMeters']
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parsePrediction(pp: JsonObject): Prediction | null {
  const placeId = pickText(pp['placeId']).trim()
  if (!placeId) return null

  const sf = readStructuredFormat(pp)
  const mainText = sf ? pickTextOrEmpty(sf['mainText'], 'text') : ''
  const secondaryText = sf ? pickTextOrEmpty(sf['secondaryText'], 'text') : ''

  const textObj = readTextObj(pp)
  const description =
    (textObj ? pickText(textObj['text']) : '').trim() ||
    [mainText, secondaryText].filter(Boolean).join(', ').trim()

  if (!description) return null

  return {
    placeId,
    description,
    mainText,
    secondaryText,
    types: readTypes(pp),
    distanceMeters: readDistanceMeters(pp),
  }
}

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

    const suggestions = readSuggestionsArray(data)

    const predictions = suggestions
      .map(readPlacePrediction)
      .filter((pp): pp is JsonObject => Boolean(pp))
      .map(parsePrediction)
      .filter((p): p is Prediction => Boolean(p))

    return jsonOk({ kind, predictions })
  } catch (e: unknown) {
    const msg = isAbortError(e) ? 'Google request timed out.' : e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/google/places/autocomplete error', e)
    return jsonFail(500, msg)
  }
}