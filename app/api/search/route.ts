// app/api/search/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import type { ProfessionType } from '@prisma/client'

export const dynamic = 'force-dynamic'

function pickNumber(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.7613
  const toRad = (d: number) => (d * Math.PI) / 180

  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)

  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const sin1 = Math.sin(dLat / 2)
  const sin2 = Math.sin(dLng / 2)

  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))

  return R * c
}

function milesToLatDelta(miles: number) {
  return miles / 69.0
}

function milesToLngDelta(miles: number, lat: number) {
  const denom = Math.cos((lat * Math.PI) / 180)
  if (!Number.isFinite(denom) || denom === 0) return miles / 69.0
  return miles / (69.0 * denom)
}

function normalizeQuery(q: string) {
  return q.trim().toLowerCase()
}

/**
 * Enum-safe matching:
 * If user types “barber”, “massage”, “nails”, etc,
 * we match against ProfessionType values using { in: [...] }.
 */
function inferProfessionTypes(q: string): ProfessionType[] {
  const s = normalizeQuery(q)
  const hits: ProfessionType[] = []

  if (s.includes('barber')) hits.push('BARBER')
  if (s.includes('cosmo') || s.includes('hair') || s.includes('stylist')) hits.push('COSMETOLOGIST')
  if (s.includes('esthetic') || s.includes('facial') || s.includes('skin')) hits.push('ESTHETICIAN')
  if (s.includes('nail') || s.includes('mani') || s.includes('pedi')) hits.push('MANICURIST')
  if (s.includes('massage')) hits.push('MASSAGE_THERAPIST')
  if (s.includes('makeup') || s.includes('mua')) hits.push('MAKEUP_ARTIST')

  return Array.from(new Set(hits))
}

function buildMapsHref(args: {
  label?: string | null
  formattedAddress?: string | null
  lat?: number | null
  lng?: number | null
  placeId?: string | null
}) {
  const { label, formattedAddress, lat, lng, placeId } = args

  // Prefer coordinates for navigation reliability
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    // Universal-ish: Apple Maps will happily open this, and Google Maps usually does too.
    // If you want “choose app” behavior, the OS will typically route correctly.
    const q = encodeURIComponent(label?.trim() || formattedAddress?.trim() || 'Salon')
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(
      placeId || '',
    )}&travelmode=driving&dir_action=navigate&query=${q}`
  }

  // If no coords, fall back to address search
  const dest = encodeURIComponent((formattedAddress || label || '').trim())
  if (dest) return `https://www.google.com/maps/search/?api=1&query=${dest}`

  return null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const q = (pickString(searchParams.get('q')) ?? '').trim()
    const tabRaw = (pickString(searchParams.get('tab')) ?? 'PROS').toUpperCase()
    const tab = tabRaw === 'SERVICES' ? 'SERVICES' : 'PROS'

    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))
    const radiusMiles = (() => {
      const r = pickNumber(searchParams.get('radiusMiles')) ?? 15
      return clampInt(r, 1, 100)
    })()

    // --- services ---
    if (tab === 'SERVICES') {
      const services = await prisma.service.findMany({
        where: q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { category: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : undefined,
        take: 40,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      })

      return jsonOk({
        ok: true,
        pros: [],
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          categoryName: s.category?.name ?? null,
        })),
      })
    }

    // --- pros ---
    const geoEnabled = lat != null && lng != null
    const origin = geoEnabled ? { lat: lat!, lng: lng! } : null

    // Bounding box deltas (used in JS pre-check)
    const latDelta = geoEnabled ? milesToLatDelta(radiusMiles) : null
    const lngDelta = geoEnabled ? milesToLngDelta(radiusMiles, lat!) : null

    const matchedProfessions = q ? inferProfessionTypes(q) : []

    const pros = await prisma.professionalProfile.findMany({
      where: {
        verificationStatus: 'APPROVED',
        ...(q
          ? {
              OR: [
                { businessName: { contains: q, mode: 'insensitive' } },
                { handle: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },

                // ✅ enum-safe profession match
                ...(matchedProfessions.length ? [{ professionType: { in: matchedProfessions } }] : []),
              ],
            }
          : {}),
      },
      take: 120,

      // ✅ ProfessionalProfile has no createdAt; keep deterministic sort
      orderBy: [{ businessName: 'asc' }, { handleNormalized: 'asc' }],

      select: {
        id: true,
        businessName: true,
        handle: true,
        professionType: true,
        avatarUrl: true,
        location: true,
        timeZone: true,
        locations: {
          where: { isPrimary: true },
          take: 1,
          select: {
            id: true,
            formattedAddress: true,
            city: true,
            state: true,
            timeZone: true,
            placeId: true, // ✅ correct field name
            lat: true,
            lng: true,
          },
        },
      },
    })

    // If no geo, just return a basic list
    if (!geoEnabled || !origin) {
      return jsonOk({
        ok: true,
        pros: pros.slice(0, 50).map((p) => {
          const primary = p.locations?.[0] ?? null
          const plat = primary?.lat != null ? Number(primary.lat as any) : null
          const plng = primary?.lng != null ? Number(primary.lng as any) : null

          const locationLabel =
            p.location ??
            (primary?.city ? `${primary.city}${primary.state ? `, ${primary.state}` : ''}` : null)

          const mapsHref = buildMapsHref({
            label: p.businessName ?? null,
            formattedAddress: primary?.formattedAddress ?? null,
            lat: plat,
            lng: plng,
            placeId: primary?.placeId ?? null,
          })

          return {
            id: p.id,
            businessName: p.businessName ?? null,
            handle: p.handle ?? null,
            professionType: p.professionType ?? null,
            avatarUrl: p.avatarUrl ?? null,
            locationLabel,
            distanceMiles: null,
            mapsHref,
            primaryLocation: primary
              ? {
                  id: primary.id,
                  formattedAddress: primary.formattedAddress ?? null,
                  city: primary.city ?? null,
                  state: primary.state ?? null,
                  timeZone: primary.timeZone ?? null,
                  lat: plat,
                  lng: plng,
                  placeId: primary.placeId ?? null,
                }
              : null,
          }
        }),
        services: [],
      })
    }

    // Geo filter + distance compute (precise)
    const withDistance = pros
      .map((p) => {
        const primary = p.locations?.[0] ?? null
        const plat = primary?.lat != null ? Number(primary.lat as any) : null
        const plng = primary?.lng != null ? Number(primary.lng as any) : null

        if (plat == null || plng == null) return { p, primary, dist: null, plat: null, plng: null }

        // bbox pre-check in JS
        if (latDelta != null && lngDelta != null) {
          if (plat < origin.lat - latDelta || plat > origin.lat + latDelta) return { p, primary, dist: null, plat, plng }
          if (plng < origin.lng - lngDelta || plng > origin.lng + lngDelta) return { p, primary, dist: null, plat, plng }
        }

        const dist = haversineMiles(origin, { lat: plat, lng: plng })
        return { p, primary, dist, plat, plng }
      })
      .filter((x) => x.dist != null && (x.dist as number) <= radiusMiles)
      .sort((a, b) => (a.dist as number) - (b.dist as number))
      .slice(0, 50)

    return jsonOk({
      ok: true,
      pros: withDistance.map(({ p, primary, dist, plat, plng }) => {
        const locationLabel =
          p.location ?? (primary?.city ? `${primary.city}${primary.state ? `, ${primary.state}` : ''}` : null)

        const mapsHref = buildMapsHref({
          label: p.businessName ?? null,
          formattedAddress: primary?.formattedAddress ?? null,
          lat: plat,
          lng: plng,
          placeId: primary?.placeId ?? null,
        })

        return {
          id: p.id,
          businessName: p.businessName ?? null,
          handle: p.handle ?? null,
          professionType: p.professionType ?? null,
          avatarUrl: p.avatarUrl ?? null,
          locationLabel,
          distanceMiles: dist,
          mapsHref,
          primaryLocation: primary
            ? {
                id: primary.id,
                formattedAddress: primary.formattedAddress ?? null,
                city: primary.city ?? null,
                state: primary.state ?? null,
                timeZone: primary.timeZone ?? null,
                lat: plat,
                lng: plng,
                placeId: primary.placeId ?? null,
              }
            : null,
        }
      }),
      services: [],
    })
  } catch (e) {
    console.error('GET /api/search error', e)
    return jsonFail(500, 'Failed to search.')
  }
}
