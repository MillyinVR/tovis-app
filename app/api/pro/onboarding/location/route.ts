// app/api/pro/onboarding/location/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function normalizeMode(v: unknown): 'SALON' | 'SUITE' | 'MOBILE' | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'SALON') return 'SALON'
  if (s === 'SUITE') return 'SUITE'
  if (s === 'MOBILE') return 'MOBILE'
  return null
}

function pickInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}

function pickBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function componentMap(addressComponents: unknown) {
  const out: Record<string, string> = {}

  if (!Array.isArray(addressComponents)) return out

  for (const item of addressComponents) {
    if (!isRecord(item)) continue

    const typesRaw = item.types
    const types =
      Array.isArray(typesRaw) ? typesRaw.filter((t): t is string => typeof t === 'string') : []

    const longName = typeof item.long_name === 'string' ? item.long_name : ''
    const shortName = typeof item.short_name === 'string' ? item.short_name : ''
    const value = (shortName || longName).trim()
    if (!value) continue

    for (const t of types) out[t] = value
  }

  return out
}

function defaultWorkingHours(): Prisma.JsonObject {
  return {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: false, start: '09:00', end: '17:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  }
}

async function googlePlaceDetails(placeId: string, sessionToken?: string | null) {
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

  const data = await safeJson<unknown>(res)
  if (!res.ok) throw new Error('Google request failed.')

  if (!isRecord(data)) throw new Error('Google response malformed.')
  const status = String(data.status ?? '')
  if (status !== 'OK') throw new Error(String(data.error_message ?? `Google status: ${status}`))

  const r = isRecord(data.result) ? data.result : {}
  const geom = isRecord(r.geometry) ? r.geometry : {}
  const loc = isRecord(geom.location) ? geom.location : {}

  const lat = typeof loc.lat === 'number' ? loc.lat : null
  const lng = typeof loc.lng === 'number' ? loc.lng : null

  const cm = componentMap(r.address_components)

  return {
    placeId: typeof r.place_id === 'string' ? r.place_id : placeId,
    name: typeof r.name === 'string' ? r.name : null,
    formattedAddress: typeof r.formatted_address === 'string' ? r.formatted_address : null,
    lat,
    lng,
    city: cm.locality || cm.postal_town || cm.sublocality || null,
    state: cm.administrative_area_level_1 || null,
    postalCode: cm.postal_code || null,
    countryCode: cm.country || null,
  }
}

async function googleTimeZone(lat: number, lng: number) {
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
  if (!res.ok) throw new Error('Google request failed.')
  if (!isRecord(data)) throw new Error('Google response malformed.')

  const status = String(data.status ?? '')
  if (status !== 'OK') {
    throw new Error(String((data as Record<string, unknown>).errorMessage ?? data.error_message ?? `Google status: ${status}`))
  }

  const tz = typeof data.timeZoneId === 'string' ? data.timeZoneId : null
  if (!tz) throw new Error('No timeZoneId returned.')
  if (!isValidIanaTimeZone(tz)) throw new Error('Returned timeZoneId is not a valid IANA timezone.')
  return tz
}

async function googleGeocodePostal(postalCode: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('key', getGoogleMapsKey())
  url.searchParams.set('address', postalCode)
  url.searchParams.set('components', 'country:us')

  const res = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  const data = await safeJson<unknown>(res)
  if (!res.ok) throw new Error('Google request failed.')
  if (!isRecord(data)) throw new Error('Google response malformed.')

  const status = String(data.status ?? '')
  if (status !== 'OK') throw new Error(String(data.error_message ?? `Google status: ${status}`))

  const first = Array.isArray(data.results) && isRecord(data.results[0]) ? data.results[0] : null
  if (!first) throw new Error('No results found.')

  const geom = isRecord(first.geometry) ? first.geometry : {}
  const loc = isRecord(geom.location) ? geom.location : {}

  const lat = typeof loc.lat === 'number' ? loc.lat : null
  const lng = typeof loc.lng === 'number' ? loc.lng : null

  const cm = componentMap(first.address_components)

  return {
    lat,
    lng,
    city: cm.locality || cm.postal_town || null,
    state: cm.administrative_area_level_1 || null,
    postalCode: cm.postal_code || null,
    countryCode: cm.country || null,
  }
}

function kmToMilesInt(km: number) {
  return Math.max(1, Math.min(200, Math.round(km * 0.621371)))
}

export async function POST(req: Request) {
  try {
    const gate = await requirePro()
    if (!gate.ok) return gate.res
    const proId = gate.proId

    const raw = await req.json().catch(() => ({}))
    const body = isRecord(raw) ? raw : {}

    const mode = normalizeMode(body['mode'])
    if (!mode) return jsonFail(400, 'Missing or invalid mode.', { code: 'INVALID_MODE' })

    const makePrimary = pickBool(body['makePrimary']) ?? true
    const workingHours = defaultWorkingHours()

    // Prisma-validated type for `type`
    type LocationType = Prisma.ProfessionalLocationCreateInput['type']

    if (mode === 'SALON' || mode === 'SUITE') {
      const placeId = pickString(body['placeId'])
      if (!placeId) return jsonFail(400, 'Missing placeId.', { code: 'MISSING_PLACE' })

      const sessionToken = pickString(body['sessionToken']) || null
      const loc = await googlePlaceDetails(placeId, sessionToken)

      if (loc.lat == null || loc.lng == null) {
        return jsonFail(400, 'Selected place is missing coordinates.', { code: 'PLACE_NO_GEO' })
      }

      const tz = await googleTimeZone(loc.lat, loc.lng)

      const nameOverride = pickString(body['locationName'])
      const locationType: LocationType = (mode === 'SALON' ? 'SALON' : 'SUITE') satisfies LocationType

      const created = await prisma.$transaction(async (tx) => {
        if (makePrimary) {
          await tx.professionalLocation.updateMany({
            where: { professionalId: proId, isPrimary: true },
            data: { isPrimary: false },
          })
        }

        const createdLoc = await tx.professionalLocation.create({
          data: {
            professionalId: proId,
            type: locationType,
            name: (nameOverride || loc.name || '').trim() || null,
            isPrimary: makePrimary,
            isBookable: true,

            formattedAddress: loc.formattedAddress,
            city: loc.city,
            state: loc.state,
            postalCode: loc.postalCode,
            countryCode: loc.countryCode,
            placeId: loc.placeId,

            lat: loc.lat,
            lng: loc.lng,

            timeZone: tz,
            workingHours,
          },
          select: { id: true, type: true, timeZone: true, isPrimary: true },
        })

        // Keep pro-level timezone aligned to latest “real” location timezone
        await tx.professionalProfile.update({
          where: { id: proId },
          data: {
            timeZone: tz,
            mobileBasePostalCode: null,
            mobileRadiusMiles: null,
          },
          select: { id: true },
        })

        return createdLoc
      })

      return jsonOk({ location: created })
    }

    // MOBILE
    const postalCode = pickString(body['postalCode'])
    if (!postalCode) return jsonFail(400, 'Missing postalCode.', { code: 'MISSING_POSTAL' })

    // Support both radiusMiles (old) and radiusKm (new UI)
    const radiusMilesRaw = pickInt(body['radiusMiles'])
    const radiusKmRaw = pickInt(body['radiusKm'])

    const radiusMiles =
      radiusMilesRaw && radiusMilesRaw >= 1 && radiusMilesRaw <= 200
        ? radiusMilesRaw
        : radiusKmRaw && radiusKmRaw >= 1 && radiusKmRaw <= 400
          ? kmToMilesInt(radiusKmRaw)
          : null

    if (!radiusMiles) {
      return jsonFail(400, 'Invalid radius. Provide radiusMiles (1–200) or radiusKm (1–400).', { code: 'INVALID_RADIUS' })
    }

    const geo = await googleGeocodePostal(postalCode)

    if (geo.lat == null || geo.lng == null) {
      return jsonFail(400, 'Could not locate that postal code.', { code: 'POSTAL_NOT_FOUND' })
    }

    const tz = await googleTimeZone(geo.lat, geo.lng)

    const nameOverride = pickString(body['locationName'])
    const mobileType: LocationType = 'MOBILE_BASE' satisfies LocationType

    const created = await prisma.$transaction(async (tx) => {
      if (makePrimary) {
        await tx.professionalLocation.updateMany({
          where: { professionalId: proId, isPrimary: true },
          data: { isPrimary: false },
        })
      }

      const createdLoc = await tx.professionalLocation.create({
        data: {
          professionalId: proId,
          type: mobileType,
          name: (nameOverride || 'Mobile base').trim() || 'Mobile base',
          isPrimary: makePrimary,
          isBookable: true,

          city: geo.city,
          state: geo.state,
          postalCode: geo.postalCode || postalCode,
          countryCode: geo.countryCode,

          lat: geo.lat,
          lng: geo.lng,

          timeZone: tz,
          workingHours,
        },
        select: { id: true, type: true, timeZone: true, isPrimary: true },
      })

      await tx.professionalProfile.update({
        where: { id: proId },
        data: {
          mobileBasePostalCode: geo.postalCode || postalCode,
          mobileRadiusMiles: radiusMiles,
          timeZone: tz,
        },
        select: { id: true },
      })

      return createdLoc
    })

    return jsonOk({ location: created })
  } catch (e: unknown) {
    console.error('POST /api/pro/onboarding/location error', e)
    const msg = e instanceof Error ? e.message : 'Internal error'
    return jsonFail(500, msg, { code: 'INTERNAL' })
  }
}