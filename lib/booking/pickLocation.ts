// lib/booking/pickLocation.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType, ProfessionalLocationType } from '@prisma/client'
import { TtlCache, stableKey } from '@/lib/cache/ttlCache'

type PickBookableLocationArgs = {
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType // booking mode: 'SALON' | 'MOBILE'
}

function cleanId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function allowedProfessionalTypes(locationType: ServiceLocationType): ProfessionalLocationType[] {
  if (locationType === 'MOBILE') return ['MOBILE_BASE']
  return ['SALON', 'SUITE']
}

// ✅ module-scope cache (Node runtime). Great for a single server / local dev.
// If you deploy serverless, this still helps “warm” instances but isn’t guaranteed shared.
const locationCache = new TtlCache<any>(800)
const TTL_MS = 10 * 60_000 // 10 minutes

export async function pickBookableLocation(args: PickBookableLocationArgs) {
  const professionalId = cleanId(args.professionalId)
  const requestedLocationId = cleanId(args.requestedLocationId)
  const allowedTypes = allowedProfessionalTypes(args.locationType)

  if (!professionalId) return null

  const cacheKey = stableKey(['pickBookableLocation', professionalId, args.locationType, requestedLocationId])
  const cached = locationCache.get(cacheKey)
  if (cached) return cached

  const select = {
    id: true,
    type: true,
    name: true,
    isPrimary: true,
    isBookable: true,

    timeZone: true,
    workingHours: true,
    bufferMinutes: true,
    stepMinutes: true,
    advanceNoticeMinutes: true,
    maxDaysAhead: true,

    lat: true,
    lng: true,

    city: true,
    formattedAddress: true,
    createdAt: true,
  } as const

  // 1) If a specific location id is requested, only honor if matches booking mode + bookable
  if (requestedLocationId) {
    const byId = await prisma.professionalLocation.findFirst({
      where: {
        id: requestedLocationId,
        professionalId,
        isBookable: true,
        type: { in: allowedTypes },
      },
      select,
    })
    if (byId?.id) {
      locationCache.set(cacheKey, byId, TTL_MS)
      return byId
    }
  }

  // 2) Otherwise pick the best match for this booking mode
  const best = await prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: allowedTypes },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select,
  })

  const result = best?.id ? best : null
  if (result) locationCache.set(cacheKey, result, TTL_MS)
  return result
}
