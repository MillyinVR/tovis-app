// app/api/client/saved-services/providers/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { Prisma, OpeningStatus, VerificationStatus } from '@prisma/client'
import { getRedis } from '@/lib/redis'
import { createHash } from 'crypto'

export const dynamic = 'force-dynamic'
// If you’re on Next “edge” runtime, remove crypto usage and I’ll adjust hashing.
// export const runtime = 'nodejs'

function parseFloatParam(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseIntParam(v: string | null) {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function parseCommaIds(v: string | null) {
  if (!v) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25)
}

function clampFloat(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

function stableHash(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)
}

// Redis helpers (fail-open)
const redis = getRedis()
async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!redis) return null
  try {
    const raw = await redis.get<string>(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!redis) return
  try {
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds })
  } catch {
    // fail-open
  }
}

function decimalToNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') {
    const n = (v as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : null
  }
  if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function') {
    const n = Number(String((v as { toString: () => string }).toString()))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(String(n))
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
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function boundsForRadiusMiles(centerLat: number, centerLng: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69
  const cos = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180))
  const lngDelta = radiusMiles / (69 * cos)

  const minLat = clampFloat(centerLat - latDelta, -90, 90)
  const maxLat = clampFloat(centerLat + latDelta, -90, 90)
  const minLng = clampFloat(centerLng - lngDelta, -180, 180)
  const maxLng = clampFloat(centerLng + lngDelta, -180, 180)

  return { minLat, maxLat, minLng, maxLng }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser().catch(() => null)
    if (!user) return jsonFail(401, 'Login required.')
    if (user.role !== 'CLIENT' || !user.clientProfile?.id) return jsonFail(403, 'Client only.')

    const { searchParams } = new URL(req.url)

    const serviceIds = parseCommaIds(searchParams.get('serviceIds'))
    const lat = parseFloatParam(searchParams.get('lat'))
    const lng = parseFloatParam(searchParams.get('lng'))
    const radiusMilesRaw = parseFloatParam(searchParams.get('radiusMiles'))
    const daysRaw = parseIntParam(searchParams.get('days'))
    const perServiceRaw = parseIntParam(searchParams.get('perService'))

    if (!serviceIds.length) return jsonFail(400, 'Missing serviceIds.')
    if (lat == null || lng == null) return jsonFail(400, 'Missing lat/lng.')

    const radiusMiles = clampFloat(radiusMilesRaw ?? 10, 1, 50)
    const days = Math.min(Math.max(daysRaw ?? 14, 1), 30)
    const perService = Math.min(Math.max(perServiceRaw ?? 10, 1), 20)

    const cacheKey = ['client:savedSvcProviders:v1', stableHash({ serviceIds, lat, lng, radiusMiles, days, perService })].join(
      ':',
    )
    const cached = await cacheGetJson<{ ok: true; byServiceId: Record<string, unknown> }>(cacheKey)
    if (cached?.byServiceId) return jsonOk(cached)

    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const bounds = boundsForRadiusMiles(lat, lng, radiusMiles)

    const rows = await prisma.lastMinuteOpening.findMany({
      where: {
        status: OpeningStatus.ACTIVE,
        startAt: { gte: now, lte: until },

        // service match: either direct serviceId, or opening tied to an offering for that service
        OR: [
          { serviceId: { in: serviceIds } },
          { offering: { is: { serviceId: { in: serviceIds } } } },
        ],

        professional: {
          verificationStatus: VerificationStatus.APPROVED,
        },

        location: {
          isBookable: true,
          lat: { not: null, gte: toDecimal(bounds.minLat), lte: toDecimal(bounds.maxLat) },
          lng: { not: null, gte: toDecimal(bounds.minLng), lte: toDecimal(bounds.maxLng) },
        },
      },
      orderBy: { startAt: 'asc' },
      take: 800,
      select: {
        id: true,
        startAt: true,
        endAt: true,
        discountPct: true,
        note: true,
        timeZone: true,
        locationType: true,
        locationId: true,
        serviceId: true,

        offering: { select: { serviceId: true } },

        professional: {
          select: {
            id: true,
            businessName: true,
            handle: true,
            avatarUrl: true,
            professionType: true,
            location: true,
          },
        },

        location: {
          select: {
            city: true,
            state: true,
            formattedAddress: true,
            lat: true,
            lng: true,
          },
        },
      },
    })

    const center = { lat, lng }

    // Build byServiceId with “one best opening per pro” (per service), then trim to perService
    const byServiceId: Record<string, Array<any>> = {}

    for (const r of rows) {
      const resolvedServiceId = (r.serviceId ?? r.offering?.serviceId ?? '').trim()
      if (!resolvedServiceId) continue

      const locLat = decimalToNumber(r.location.lat)
      const locLng = decimalToNumber(r.location.lng)
      if (locLat == null || locLng == null) continue

      const d = haversineMiles(center, { lat: locLat, lng: locLng })
      if (d > radiusMiles) continue

      const entry = {
        professional: {
          id: r.professional.id,
          businessName: r.professional.businessName ?? null,
          handle: r.professional.handle ?? null,
          avatarUrl: r.professional.avatarUrl ?? null,
          professionType: r.professional.professionType ?? null,
          location: r.professional.location ?? null,
        },
        opening: {
          id: r.id,
          startAt: r.startAt.toISOString(),
          endAt: r.endAt ? r.endAt.toISOString() : null,
          discountPct: typeof r.discountPct === 'number' ? r.discountPct : null,
          note: r.note ?? null,
          timeZone: r.timeZone,
          locationType: String(r.locationType),
          locationId: r.locationId,
          city: r.location.city ?? null,
          state: r.location.state ?? null,
          formattedAddress: r.location.formattedAddress ?? null,
        },
        distanceMiles: Math.round(d * 10) / 10,
      }

      if (!byServiceId[resolvedServiceId]) byServiceId[resolvedServiceId] = []

      // Dedupe per pro per service: keep earliest (rows are already sorted by startAt asc)
      const existingIdx = byServiceId[resolvedServiceId].findIndex((x) => x.professional.id === entry.professional.id)
      if (existingIdx === -1) byServiceId[resolvedServiceId].push(entry)
    }

    // Sort inside each service: soonest first, then closer
    for (const sid of Object.keys(byServiceId)) {
      byServiceId[sid].sort((a, b) => {
        const ta = new Date(a.opening.startAt).getTime()
        const tb = new Date(b.opening.startAt).getTime()
        if (ta !== tb) return ta - tb
        return a.distanceMiles - b.distanceMiles
      })
      byServiceId[sid] = byServiceId[sid].slice(0, perService)
    }

    const payload = { ok: true as const, byServiceId }
    void cacheSetJson(cacheKey, payload, 30)

    return jsonOk(payload)
  } catch (e) {
    console.error('GET /api/client/saved-services/providers error', e)
    return jsonFail(500, 'Failed to load providers.')
  }
}