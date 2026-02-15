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

function toNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v))
  return Number.isFinite(n) ? n : null
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.7613 // miles
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

  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    const q = encodeURIComponent(label?.trim() || formattedAddress?.trim() || 'Location')
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(
      placeId || '',
    )}&travelmode=driving&dir_action=navigate&query=${q}`
  }

  const dest = encodeURIComponent((formattedAddress || label || '').trim())
  if (dest) return `https://www.google.com/maps/search/?api=1&query=${dest}`

  return null
}

type LocationDTO = {
  id: string
  formattedAddress: string | null
  city: string | null
  state: string | null
  timeZone: string | null
  placeId: string | null
  lat: number | null
  lng: number | null
  isPrimary: boolean
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)

    const q = (pickString(searchParams.get('q')) ?? '').trim()
    const tabRaw = (pickString(searchParams.get('tab')) ?? 'PROS').toUpperCase()
    const tab = tabRaw === 'SERVICES' ? 'SERVICES' : 'PROS'

    const lat = pickNumber(searchParams.get('lat'))
    const lng = pickNumber(searchParams.get('lng'))

    // ✅ This endpoint is miles (not km)
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
                ...(matchedProfessions.length ? [{ professionType: { in: matchedProfessions } }] : []),
              ],
            }
          : {}),
      },
      take: 200,
      orderBy: [{ businessName: 'asc' }, { handleNormalized: 'asc' }],
      select: {
        id: true,
        businessName: true,
        handle: true,
        professionType: true,
        avatarUrl: true,
        location: true,
        timeZone: true,

        // ✅ Pull ALL bookable locations w/ coordinates (not just primary)
        locations: {
          where: {
            isBookable: true,
            lat: { not: null },
            lng: { not: null },
          },
          take: 25,
          select: {
            id: true,
            formattedAddress: true,
            city: true,
            state: true,
            timeZone: true,
            placeId: true,
            lat: true,
            lng: true,
            isPrimary: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    })

    // No-geo: return list (use primary if present, otherwise first bookable)
    if (!geoEnabled || !origin) {
      return jsonOk({
        ok: true,
        pros: pros.slice(0, 50).map((p) => {
          const locs: LocationDTO[] = (p.locations ?? []).map((l) => ({
            id: l.id,
            formattedAddress: l.formattedAddress ?? null,
            city: l.city ?? null,
            state: l.state ?? null,
            timeZone: l.timeZone ?? null,
            placeId: l.placeId ?? null,
            lat: toNum(l.lat),
            lng: toNum(l.lng),
            isPrimary: Boolean(l.isPrimary),
          }))

          const primary = locs.find((x) => x.isPrimary) ?? locs[0] ?? null

          const locationLabel =
            p.location ??
            (primary?.city ? `${primary.city}${primary.state ? `, ${primary.state}` : ''}` : null)

          const mapsHref = buildMapsHref({
            label: p.businessName ?? null,
            formattedAddress: primary?.formattedAddress ?? null,
            lat: primary?.lat ?? null,
            lng: primary?.lng ?? null,
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

            // Keep both for UI flexibility
            closestLocation: primary,
            primaryLocation: locs.find((x) => x.isPrimary) ?? null,
          }
        }),
        services: [],
      })
    }

    // Geo-enabled: compute MIN distance across locations
    const withDistance = pros
      .map((p) => {
        const locs: LocationDTO[] = (p.locations ?? [])
          .map((l) => ({
            id: l.id,
            formattedAddress: l.formattedAddress ?? null,
            city: l.city ?? null,
            state: l.state ?? null,
            timeZone: l.timeZone ?? null,
            placeId: l.placeId ?? null,
            lat: toNum(l.lat),
            lng: toNum(l.lng),
            isPrimary: Boolean(l.isPrimary),
          }))
          .filter((l) => l.lat != null && l.lng != null)

        if (!locs.length) return null

        let best: { dist: number; loc: LocationDTO } | null = null

        for (const loc of locs) {
          const plat = loc.lat!
          const plng = loc.lng!

          // bbox pre-check
          if (latDelta != null && lngDelta != null) {
            if (plat < origin.lat - latDelta || plat > origin.lat + latDelta) continue
            if (plng < origin.lng - lngDelta || plng > origin.lng + lngDelta) continue
          }

          const dist = haversineMiles(origin, { lat: plat, lng: plng })
          if (!Number.isFinite(dist)) continue
          if (best == null || dist < best.dist) best = { dist, loc }
        }

        if (!best) return null
        if (best.dist > radiusMiles) return null

        const primary = locs.find((x) => x.isPrimary) ?? null

        return {
          p,
          dist: best.dist,
          closest: best.loc,
          primary,
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.dist - b.dist)
      .slice(0, 50)

    return jsonOk({
      ok: true,
      pros: withDistance.map((x: any) => {
        const p = x.p as (typeof pros)[number]
        const closest: LocationDTO = x.closest
        const primary: LocationDTO | null = x.primary ?? null

        const locationLabel =
          p.location ??
          (closest?.city ? `${closest.city}${closest.state ? `, ${closest.state}` : ''}` : null)

        const mapsHref = buildMapsHref({
          label: p.businessName ?? null,
          formattedAddress: closest?.formattedAddress ?? null,
          lat: closest?.lat ?? null,
          lng: closest?.lng ?? null,
          placeId: closest?.placeId ?? null,
        })

        return {
          id: p.id,
          businessName: p.businessName ?? null,
          handle: p.handle ?? null,
          professionType: p.professionType ?? null,
          avatarUrl: p.avatarUrl ?? null,
          locationLabel,
          distanceMiles: x.dist,
          mapsHref,

          closestLocation: closest,
          primaryLocation: primary,
        }
      }),
      services: [],
    })
  } catch (e) {
    console.error('GET /api/search error', e)
    return jsonFail(500, 'Failed to search.')
  }
}
