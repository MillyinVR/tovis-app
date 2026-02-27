// app/api/pro/onboarding/location/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { getGoogleMapsKey, fetchWithTimeout, safeJson } from '@/app/api/_utils'
import { requirePro } from '@/app/api/_utils/auth/requirePro'

export const dynamic = 'force-dynamic'

type Body = {
  mode?: unknown // 'SALON' | 'SUITE' | 'MOBILE'
  placeId?: unknown // required for SALON/SUITE
  locationName?: unknown // optional override label
  postalCode?: unknown // required for MOBILE (US zip)
  radiusMiles?: unknown // required for MOBILE (miles)
  sessionToken?: unknown // optional pass-through for Places billing/session

  // controls whether the created location becomes primary
  makePrimary?: unknown // boolean, defaults true
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

function defaultWorkingHours() {
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

  const data = await safeJson<any>(res)
  if (!res.ok) throw new Error('Google request failed.')

  const status = String(data?.status ?? '')
  if (status !== 'OK') throw new Error(data?.error_message || `Google status: ${status}`)

  const r = data?.result ?? {}
  const loc = r?.geometry?.location ?? {}
  const lat = typeof loc?.lat === 'number' ? loc.lat : null
  const lng = typeof loc?.lng === 'number' ? loc.lng : null

  const cm = componentMap(Array.isArray(r?.address_components) ? r.address_components : [])

  return {
    placeId: String(r?.place_id ?? placeId),
    name: typeof r?.name === 'string' ? r.name : null,
    formattedAddress: typeof r?.formatted_address === 'string' ? r.formatted_address : null,
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

  const data = await safeJson<any>(res)
  if (!res.ok) throw new Error('Google request failed.')

  const status = String(data?.status ?? '')
  if (status !== 'OK') throw new Error(data?.errorMessage || data?.error_message || `Google status: ${status}`)

  const tz = typeof data?.timeZoneId === 'string' ? data.timeZoneId : null
  if (!tz) throw new Error('No timeZoneId returned.')
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

  const data = await safeJson<any>(res)
  if (!res.ok) throw new Error('Google request failed.')

  const status = String(data?.status ?? '')
  if (status !== 'OK') throw new Error(data?.error_message || `Google status: ${status}`)

  const first = Array.isArray(data?.results) ? data.results[0] : null
  if (!first) throw new Error('No results found.')

  const loc = first?.geometry?.location ?? {}
  const lat = typeof loc?.lat === 'number' ? loc.lat : null
  const lng = typeof loc?.lng === 'number' ? loc.lng : null

  const cm = componentMap(Array.isArray(first?.address_components) ? first.address_components : [])

  return {
    lat,
    lng,
    city: cm.locality || cm.postal_town || null,
    state: cm.administrative_area_level_1 || null,
    postalCode: cm.postal_code || null,
    countryCode: cm.country || null,
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requirePro()
    if (gate.res) return gate.res

    const proId = gate.proId

    const body = (await req.json().catch(() => ({}))) as Body
    const mode = normalizeMode(body.mode)
    if (!mode) return jsonFail(400, 'Missing or invalid mode.', { code: 'INVALID_MODE' })

    // default to true so existing callers behave the same
    const makePrimary = pickBool(body.makePrimary) ?? true

    const workingHours = defaultWorkingHours()

    // Only clear old primary IF we are making this new one primary
    if (makePrimary) {
      await prisma.professionalLocation.updateMany({
        where: { professionalId: proId, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    if (mode === 'SALON' || mode === 'SUITE') {
      const placeId = pickString(body.placeId)
      if (!placeId) return jsonFail(400, 'Missing placeId.', { code: 'MISSING_PLACE' })

      const sessionToken = pickString(body.sessionToken)
      const loc = await googlePlaceDetails(placeId, sessionToken)

      if (loc.lat == null || loc.lng == null) {
        return jsonFail(400, 'Selected place is missing coordinates.', { code: 'PLACE_NO_GEO' })
      }

      const tz = await googleTimeZone(loc.lat, loc.lng)

      const nameOverride = pickString(body.locationName)
      const locationType = mode === 'SALON' ? 'SALON' : 'SUITE'

      const created = await prisma.professionalLocation.create({
        data: {
          professionalId: proId,
          type: locationType as any,
          name: nameOverride || loc.name || null,
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

      // Keep pro fallback timezone updated (always)
      await prisma.professionalProfile.update({
        where: { id: proId },
        data: {
          timeZone: tz,
          // If they switch away from mobile, clear mobile config
          mobileBasePostalCode: null,
          mobileRadiusMiles: null,
        },
        select: { id: true },
      })

      return jsonOk({ ok: true, location: created })
    }

    // MOBILE
    const postalCode = pickString(body.postalCode)
    const radiusMiles = pickInt(body.radiusMiles)

    if (!postalCode) return jsonFail(400, 'Missing postalCode.', { code: 'MISSING_POSTAL' })

    if (!radiusMiles || radiusMiles < 1 || radiusMiles > 200) {
      return jsonFail(400, 'Invalid radiusMiles.', { code: 'INVALID_RADIUS' })
    }

    const geo = await googleGeocodePostal(postalCode)

    if (geo.lat == null || geo.lng == null) {
      return jsonFail(400, 'Could not locate that postal code.', { code: 'POSTAL_NOT_FOUND' })
    }

    const tz = await googleTimeZone(geo.lat, geo.lng)

    const created = await prisma.professionalLocation.create({
      data: {
        professionalId: proId,
        type: 'MOBILE_BASE',
        name: 'Mobile base',
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

    await prisma.professionalProfile.update({
      where: { id: proId },
      data: {
        mobileBasePostalCode: geo.postalCode || postalCode,
        mobileRadiusMiles: radiusMiles,
        timeZone: tz,
      },
      select: { id: true },
    })

    return jsonOk({ ok: true, location: created })
  } catch (e: any) {
    console.error('POST /api/pro/onboarding/location error', e)
    return jsonFail(500, e?.message || 'Internal error', { code: 'INTERNAL' })
  }
}