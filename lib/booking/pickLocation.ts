// lib/booking/pickLocation.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { isRecord } from '@/lib/guards'

type PickBookableLocationArgs = {
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType // SALON | MOBILE
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

export type BookableLocation = Prisma.ProfessionalLocationGetPayload<{ select: typeof select }>

function cleanId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function allowedProfessionalTypes(locationType: ServiceLocationType): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function isUsableLocation(loc: BookableLocation | null): loc is BookableLocation {
  if (!loc?.id) return false
  if (!loc.isBookable) return false

  const tz = typeof loc.timeZone === 'string' ? loc.timeZone.trim() : ''
  if (!tz || !isValidIanaTimeZone(tz)) return false

  // workingHours is Json in schema; require object-ish (not array/null)
  if (!isRecord(loc.workingHours)) return false

  return true
}

/**
 * Pick a bookable location for availability/hold/finalize logic.
 *
 * Rules:
 * 1) If requestedLocationId is provided, honor it ONLY if it matches:
 *    - same professional
 *    - isBookable
 *    - correct allowed location type(s) for the booking mode
 *    - valid IANA timezone
 *    - workingHours object present
 * 2) Otherwise pick best by: isPrimary desc, createdAt asc
 *
 * NOTE: No caching here on purpose—so pro updates reflect immediately.
 */
export async function pickBookableLocation(args: PickBookableLocationArgs): Promise<BookableLocation | null> {
  const professionalId = cleanId(args.professionalId)
  const requestedLocationId = cleanId(args.requestedLocationId)

  if (!professionalId) return null

  const allowedTypes = allowedProfessionalTypes(args.locationType)

  // 1) requested location (only if valid + matches mode)
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

    if (isUsableLocation(byId)) return byId
  }

  // 2) best fallback for this booking mode
  const best = await prisma.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: allowedTypes },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select,
  })

  return isUsableLocation(best) ? best : null
}