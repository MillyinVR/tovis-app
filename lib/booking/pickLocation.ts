// lib/booking/pickLocation.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType, ProfessionalLocationType, Prisma } from '@prisma/client'
import { TtlCache, stableKey } from '@/lib/cache/ttlCache'
import { isValidIanaTimeZone } from '@/lib/timeZone'

type PickBookableLocationArgs = {
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType // 'SALON' | 'MOBILE'
}

function cleanId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function allowedProfessionalTypes(locationType: ServiceLocationType): ProfessionalLocationType[] {
  return locationType === 'MOBILE' ? ['MOBILE_BASE'] : ['SALON', 'SUITE']
}

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
} satisfies Prisma.ProfessionalLocationSelect

type PickedLocation = Prisma.ProfessionalLocationGetPayload<{ select: typeof select }>

// module-scope cache
const locationCache = new TtlCache<PickedLocation>(800)
const TTL_MS = 10 * 60_000 // 10 minutes

function isUsableLocation(loc: PickedLocation | null): loc is PickedLocation {
  if (!loc?.id) return false
  const tz = typeof loc.timeZone === 'string' ? loc.timeZone.trim() : ''
  if (!tz || !isValidIanaTimeZone(tz)) return false
  // workingHours is Json in schema; still sanity check shape
  if (!loc.workingHours || typeof loc.workingHours !== 'object') return false
  return true
}

export async function pickBookableLocation(args: PickBookableLocationArgs): Promise<PickedLocation | null> {
  const professionalId = cleanId(args.professionalId)
  const requestedLocationId = cleanId(args.requestedLocationId)
  const allowedTypes = allowedProfessionalTypes(args.locationType)

  if (!professionalId) return null

  const cacheKey = stableKey(['pickBookableLocation', professionalId, args.locationType, requestedLocationId])
  const cached = locationCache.get(cacheKey)
  if (cached) return cached

  // 1) honor requested id only if it matches booking mode + is bookable
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

    if (isUsableLocation(byId)) {
      locationCache.set(cacheKey, byId, TTL_MS)
      return byId
    }
  }

  // 2) otherwise pick best match for this booking mode
  const best = await prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: allowedTypes },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select,
  })

  if (!isUsableLocation(best)) return null

  locationCache.set(cacheKey, best, TTL_MS)
  return best
}
