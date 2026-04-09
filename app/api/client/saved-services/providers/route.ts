// app/api/client/saved-services/providers/route.ts
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  LastMinuteOfferType,
  LastMinuteTier,
  LastMinuteVisibilityMode,
  OpeningStatus,
  Prisma,
  VerificationStatus,
} from '@prisma/client'
import { getRedis } from '@/lib/redis'
import { createHash } from 'crypto'

export const dynamic = 'force-dynamic'

type SavedServiceProviderEntry = {
  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    professionType: string | null
    location: string | null
  }
  opening: {
    id: string
    serviceId: string
    offeringId: string
    startAt: string
    endAt: string | null
    discountPct: number | null
    note: string | null
    timeZone: string
    locationType: string
    locationId: string
    city: string | null
    state: string | null
    formattedAddress: string | null
    publicIncentive: {
      tier: LastMinuteTier
      offerType: LastMinuteOfferType
      label: string
      percentOff: number | null
      amountOff: string | null
      freeAddOnService: { id: string; name: string } | null
    } | null
  }
  distanceMiles: number
}

type SavedServiceProvidersPayload = {
  ok: true
  byServiceId: Record<string, SavedServiceProviderEntry[]>
}

const openingSelect = {
  id: true,
  professionalId: true,
  startAt: true,
  endAt: true,
  note: true,
  status: true,
  visibilityMode: true,
  publicVisibleFrom: true,
  publicVisibleUntil: true,
  bookedAt: true,
  cancelledAt: true,
  timeZone: true,
  locationType: true,
  locationId: true,

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

  services: {
    where: {
      offering: {
        is: {
          isActive: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      serviceId: true,
      offeringId: true,
      sortOrder: true,
      service: {
        select: {
          id: true,
          name: true,
        },
      },
      offering: {
        select: {
          id: true,
        },
      },
    },
  },

  tierPlans: {
    where: {
      cancelledAt: null,
    },
    orderBy: [{ scheduledFor: 'asc' }, { tier: 'asc' }],
    select: {
      id: true,
      tier: true,
      scheduledFor: true,
      offerType: true,
      percentOff: true,
      amountOff: true,
      freeAddOnService: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.LastMinuteOpeningSelect

type OpeningRow = Prisma.LastMinuteOpeningGetPayload<{
  select: typeof openingSelect
}>

type PublicTierPlanRow = OpeningRow['tierPlans'][number]

function parseFloatParam(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function parseIntParam(v: string | null): number | null {
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function parseCommaIds(v: string | null): string[] {
  if (!v) return []
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 25)
}

function clampFloat(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(Math.max(n, min), max)
}

function stableHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)
}

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

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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

function pickPublicTierPlan(row: OpeningRow, now: Date): PublicTierPlanRow | null {
  if (row.tierPlans.length === 0) return null

  if (row.visibilityMode === LastMinuteVisibilityMode.PUBLIC_AT_DISCOVERY) {
    return row.tierPlans.find((plan) => plan.tier === LastMinuteTier.DISCOVERY) ?? null
  }

  if (row.visibilityMode === LastMinuteVisibilityMode.PUBLIC_IMMEDIATE) {
    const started = row.tierPlans.filter((plan) => plan.scheduledFor.getTime() <= now.getTime())
    if (started.length > 0) {
      return started[started.length - 1] ?? null
    }
    return row.tierPlans[0] ?? null
  }

  return null
}

function incentiveLabel(plan: PublicTierPlanRow): string {
  if (plan.offerType === LastMinuteOfferType.PERCENT_OFF && plan.percentOff != null) {
    return `${plan.percentOff}% off`
  }

  if (plan.offerType === LastMinuteOfferType.AMOUNT_OFF && plan.amountOff) {
    return `$${plan.amountOff.toString()} off`
  }

  if (plan.offerType === LastMinuteOfferType.FREE_SERVICE) {
    return 'Free service'
  }

  if (plan.offerType === LastMinuteOfferType.FREE_ADD_ON) {
    return plan.freeAddOnService?.name || 'Free add-on'
  }

  return 'No incentive'
}

function mapPublicIncentive(plan: PublicTierPlanRow | null): SavedServiceProviderEntry['opening']['publicIncentive'] {
  if (!plan) return null

  return {
    tier: plan.tier,
    offerType: plan.offerType,
    label: incentiveLabel(plan),
    percentOff: plan.percentOff ?? null,
    amountOff: plan.amountOff ? plan.amountOff.toString() : null,
    freeAddOnService: plan.freeAddOnService
      ? {
          id: plan.freeAddOnService.id,
          name: plan.freeAddOnService.name,
        }
      : null,
  }
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

    const cacheKey = [
      'client:savedSvcProviders:v2',
      stableHash({ serviceIds, lat, lng, radiusMiles, days, perService }),
    ].join(':')

    const cached = await cacheGetJson<SavedServiceProvidersPayload>(cacheKey)
    if (cached?.byServiceId) {
      return jsonOk(cached)
    }

    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    const bounds = boundsForRadiusMiles(lat, lng, radiusMiles)

    const rows = await prisma.lastMinuteOpening.findMany({
      where: {
        status: OpeningStatus.ACTIVE,
        bookedAt: null,
        cancelledAt: null,
        startAt: { gte: now, lte: until },
        publicVisibleFrom: { lte: now },
        OR: [{ publicVisibleUntil: null }, { publicVisibleUntil: { gt: now } }],
        services: {
          some: {
            serviceId: { in: serviceIds },
            offering: {
              is: {
                isActive: true,
              },
            },
          },
        },
        professional: {
          verificationStatus: VerificationStatus.APPROVED,
        },
        location: {
          isBookable: true,
          lat: { not: null, gte: toDecimal(bounds.minLat), lte: toDecimal(bounds.maxLat) },
          lng: { not: null, gte: toDecimal(bounds.minLng), lte: toDecimal(bounds.maxLng) },
        },
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      take: 800,
      select: openingSelect,
    })

    const center = { lat, lng }
    const requestedServiceIds = new Set(serviceIds)
    const byServiceId: Record<string, SavedServiceProviderEntry[]> = {}

    for (const row of rows) {
      const locLat = decimalToNumber(row.location.lat)
      const locLng = decimalToNumber(row.location.lng)
      if (locLat == null || locLng == null) continue

      const distanceMiles = haversineMiles(center, { lat: locLat, lng: locLng })
      if (distanceMiles > radiusMiles) continue

      const publicPlan = pickPublicTierPlan(row, now)
      const publicIncentive = mapPublicIncentive(publicPlan)
      const derivedDiscountPct =
        publicPlan?.offerType === LastMinuteOfferType.PERCENT_OFF ? publicPlan.percentOff ?? null : null

      const matchedServices = row.services.filter((serviceRow) => requestedServiceIds.has(serviceRow.serviceId))

      for (const serviceRow of matchedServices) {
        const resolvedServiceId = serviceRow.serviceId.trim()
        if (!resolvedServiceId) continue

        const entry: SavedServiceProviderEntry = {
          professional: {
            id: row.professional.id,
            businessName: row.professional.businessName ?? null,
            handle: row.professional.handle ?? null,
            avatarUrl: row.professional.avatarUrl ?? null,
            professionType: row.professional.professionType ?? null,
            location: row.professional.location ?? null,
          },
          opening: {
            id: row.id,
            serviceId: resolvedServiceId,
            offeringId: serviceRow.offeringId,
            startAt: row.startAt.toISOString(),
            endAt: row.endAt ? row.endAt.toISOString() : null,
            discountPct: derivedDiscountPct,
            note: row.note ?? null,
            timeZone: row.timeZone,
            locationType: String(row.locationType),
            locationId: row.locationId,
            city: row.location.city ?? null,
            state: row.location.state ?? null,
            formattedAddress: row.location.formattedAddress ?? null,
            publicIncentive,
          },
          distanceMiles: Math.round(distanceMiles * 10) / 10,
        }

        if (!byServiceId[resolvedServiceId]) {
          byServiceId[resolvedServiceId] = []
        }

        const existingIdx = byServiceId[resolvedServiceId].findIndex(
          (x) => x.professional.id === entry.professional.id,
        )

        if (existingIdx === -1) {
          byServiceId[resolvedServiceId].push(entry)
        }
      }
    }

    for (const sid of Object.keys(byServiceId)) {
      byServiceId[sid].sort((a, b) => {
        const ta = new Date(a.opening.startAt).getTime()
        const tb = new Date(b.opening.startAt).getTime()
        if (ta !== tb) return ta - tb
        return a.distanceMiles - b.distanceMiles
      })
      byServiceId[sid] = byServiceId[sid].slice(0, perService)
    }

    const payload: SavedServiceProvidersPayload = { ok: true, byServiceId }
    void cacheSetJson(cacheKey, payload, 30)

    return jsonOk(payload)
  } catch (e) {
    console.error('GET /api/client/saved-services/providers error', e)
    return jsonFail(500, 'Failed to load providers.')
  }
}