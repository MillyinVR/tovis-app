// lib/booking/pickLocation.ts
import { prisma } from '@/lib/prisma'
import type { ServiceLocationType, ProfessionalLocationType } from '@prisma/client'

type PickBookableLocationArgs = {
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType // booking mode: 'SALON' | 'MOBILE'
}

function cleanId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function allowedProfessionalTypes(locationType: ServiceLocationType): ProfessionalLocationType[] {
  // Booking mode (ServiceLocationType) -> Stored location types (ProfessionalLocationType)
  if (locationType === 'MOBILE') return ['MOBILE_BASE']
  // SALON booking includes both SALON and SUITE locations
  return ['SALON', 'SUITE']
}

export async function pickBookableLocation(args: PickBookableLocationArgs) {
  const professionalId = cleanId(args.professionalId)
  const requestedLocationId = cleanId(args.requestedLocationId)
  const allowedTypes = allowedProfessionalTypes(args.locationType)

  if (!professionalId) return null

  const select = {
    id: true,
    type: true,
    name: true,
    isPrimary: true,
    isBookable: true,

    // schedule + booking defaults
    timeZone: true,
    workingHours: true,
    bufferMinutes: true,
    stepMinutes: true,
    advanceNoticeMinutes: true,
    maxDaysAhead: true,

    // ✅ geo (needed by holds/bookings snapshots)
    lat: true,
    lng: true,

    // display
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
    if (byId?.id) return byId
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

  return best?.id ? best : null
}
