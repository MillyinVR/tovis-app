// app/api/google/places/details/route.ts
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

type JsonObject = Record<string, unknown>

function normalizePlaceResourceName(raw: string) {
  const s = raw.trim()
  if (!s) return null
  return s.startsWith('places/') ? s : `places/${s}`
}

function isRecord(x: unknown): x is JsonObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function pickText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function pickNullableText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

function componentMapFromAddressComponents(addressComponents: unknown) {
  const out: Record<string, string> = {}
  if (!Array.isArray(addressComponents)) return out

  for (const c of addressComponents) {
    if (!isRecord(c)) continue

    const typesRaw = c.types
    const types = Array.isArray(typesRaw) ? typesRaw.filter((t): t is string => typeof t === 'string') : []

    const longName = pickText(c.longText)
    const shortName = pickText(c.shortText)
    const value = (shortName || longName).trim()
    if (!value) continue

    for (const t of types) {
      const key = (t || '').trim()
      if (!key) continue
      out[key] = value
    }
  }

  return out
}

function parseViewport(v: unknown): { north: number; south: number; east: number; west: number } | null {
  if (!isRecord(v)) return null
  const low = isRecord(v.low) ? v.low : null
  const high = isRecord(v.high) ? v.high : null
  if (!low || !high) return null

  const south = typeof low.latitude === 'number' ? low.latitude : null
  const west = typeof low.longitude === 'number' ? low.longitude : null
  const north = typeof high.latitude === 'number' ? high.latitude : null
  const east = typeof high.longitude === 'number' ? high.longitude : null

  if (south == null || west == null || north == null || east == null) return null
  return { north, south, east, west }
}

function readDisplayNameText(displayName: unknown): string | null {
  // Places API v1 usually returns a LocalizedText object like { text, languageCode }
  if (typeof displayName === 'string') return displayName.trim() || null
  if (!isRecord(displayName)) return null
  const t = displayName.text
  return typeof t === 'string' ? (t.trim() || null) : null
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

    const placeIdRaw = pickString(searchParams.get('placeId'))
    if (!placeIdRaw) return jsonFail(400, 'Missing placeId.')

    const sessionToken = pickString(searchParams.get('sessionToken'))

    const name = normalizePlaceResourceName(placeIdRaw)
    if (!name) return jsonFail(400, 'Invalid placeId.')

    // Encode WITHOUT encoding slashes in "places/{id}"
    const url = `https://places.googleapis.com/v1/${encodeURI(name)}`

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getGoogleMapsKey(),
        // FieldMask is REQUIRED by Places API (New)
        'X-Goog-FieldMask': [
          'id',
          'name',
          'displayName',
          'formattedAddress',
          'location',
          'viewport',
          'addressComponents',
          'types',
        ].join(','),
        ...(sessionToken ? { 'X-Goog-Session-Token': sessionToken } : {}),
      },
      cache: 'no-store',
    })

    const data = await safeJson<unknown>(res)
    if (!res.ok) return jsonFail(502, 'Google request failed.', { details: data })
    if (!isRecord(data)) return jsonFail(502, 'Google returned an unexpected response shape.')

    const loc = isRecord(data.location) ? data.location : null
    const lat = loc && typeof loc.latitude === 'number' ? loc.latitude : null
    const lng = loc && typeof loc.longitude === 'number' ? loc.longitude : null
    if (lat == null || lng == null) return jsonFail(502, 'Place has no location coordinates.', { details: data })

    const viewport = parseViewport(data.viewport)

    const formattedAddress = pickNullableText(data.formattedAddress)
    const nameText = readDisplayNameText(data.displayName)

    const cm = componentMapFromAddressComponents(data.addressComponents)

    // "city" can appear under different keys depending on the place type
    const city =
      cm.locality ||
      cm.postal_town ||
      cm.sublocality ||
      cm.sublocality_level_1 ||
      cm.neighborhood ||
      null

    const state = cm.administrative_area_level_1 || null
    const postalCode = cm.postal_code || null
    const countryCode = cm.country || null

    const types = Array.isArray(data.types) ? data.types.filter((x): x is string => typeof x === 'string') : []

    return jsonOk({
      place: {
        resourceName: typeof data.name === 'string' ? data.name : name,
        placeId: typeof data.id === 'string' ? data.id : placeIdRaw,
        name: nameText,
        formattedAddress,
        lat,
        lng,
        viewport,
        components: cm,
        city,
        state,
        postalCode,
        countryCode,
        types,
      },
    })
  } catch (e: unknown) {
    const msg = isAbortError(e) ? 'Google request timed out.' : e instanceof Error ? e.message : 'Internal error'
    console.error('GET /api/google/places/details error', e)
    return jsonFail(500, msg)
  }
}