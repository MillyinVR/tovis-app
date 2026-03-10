// lib/booking/pickLocation.ts
import { prisma } from '@/lib/prisma'
import { Prisma, ProfessionalLocationType, ServiceLocationType } from '@prisma/client'

export type BookingDbClient = Prisma.TransactionClient | typeof prisma

type PickBookableLocationArgs = {
  tx?: BookingDbClient
  professionalId: string
  requestedLocationId?: string | null
  locationType: ServiceLocationType
  allowFallback?: boolean
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

export type BookableLocation = Prisma.ProfessionalLocationGetPayload<{
  select: typeof select
}>

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function db(tx?: BookingDbClient): BookingDbClient {
  return tx ?? prisma
}

function allowedProfessionalTypes(
  locationType: ServiceLocationType,
): ProfessionalLocationType[] {
  return locationType === ServiceLocationType.MOBILE
    ? [ProfessionalLocationType.MOBILE_BASE]
    : [ProfessionalLocationType.SALON, ProfessionalLocationType.SUITE]
}

function isBookableLocationCandidate(
  location: BookableLocation | null,
): location is BookableLocation {
  return Boolean(location?.id && location.isBookable)
}

/**
 * Pick the location candidate for booking flows.
 *
 * Intentionally does NOT validate timezone or workingHours shape.
 * Those belong to higher-level booking context / working-hours helpers,
 * so callers can distinguish:
 * - LOCATION_NOT_FOUND
 * - TIMEZONE_REQUIRED
 * - working-hours issues
 */
export async function pickBookableLocation(
  args: PickBookableLocationArgs,
): Promise<BookableLocation | null> {
  const professionalId = cleanId(args.professionalId)
  const requestedLocationId = cleanId(args.requestedLocationId)
  const database = db(args.tx)

  if (!professionalId) return null

  const allowedTypes = allowedProfessionalTypes(args.locationType)

  if (requestedLocationId) {
    const byId = await database.professionalLocation.findFirst({
      where: {
        id: requestedLocationId,
        professionalId,
        isBookable: true,
        type: { in: allowedTypes },
      },
      select,
    })

    return isBookableLocationCandidate(byId) ? byId : null
  }

  const best = await database.professionalLocation.findFirst({
    where: {
      professionalId,
      isBookable: true,
      type: { in: allowedTypes },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select,
  })

  return isBookableLocationCandidate(best) ? best : null
}