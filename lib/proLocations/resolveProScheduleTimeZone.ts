import { prisma } from '@/lib/prisma'
import { DEFAULT_TIME_ZONE, pickTimeZoneOrNull } from '@/lib/time'

/**
 * Resolve the timezone a professional's schedule, bookings, and chart records
 * should be displayed in.
 *
 * Precedence: primary bookable location tz → any bookable location tz → the
 * pro profile's stored tz → DEFAULT_TIME_ZONE. This is the single source of
 * truth for "what zone does this pro operate in" on server-rendered pro
 * surfaces, so date/time labels don't fall back to the server zone (UTC on
 * Vercel) and render the wrong day.
 *
 * For a specific appointment, prefer the booking's own snapshot/location
 * timezone when present and use this only as the fallback.
 */
export async function resolveProScheduleTimeZone(
  proId: string,
  proTimeZoneRaw: unknown,
): Promise<string> {
  const locations = await prisma.professionalLocation.findMany({
    where: {
      professionalId: proId,
      isBookable: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      timeZone: true,
    },
    take: 50,
  })

  for (const location of locations) {
    const tz = pickTimeZoneOrNull(location.timeZone)
    if (tz) return tz
  }

  const proTz = pickTimeZoneOrNull(proTimeZoneRaw)
  if (proTz) return proTz

  return DEFAULT_TIME_ZONE
}
