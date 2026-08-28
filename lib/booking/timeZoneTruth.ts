// lib/booking/timeZoneTruth.ts
//
// The SERVER half of timezone truth: the resolvers that may fall back to a
// `ProfessionalLocation` lookup when only ids are in hand.
//
// The pure precedence rules and the types live in the client-safe sibling
// `@/lib/booking/timeZoneTruthValues`, and are re-exported here so existing
// server call sites keep importing timezone truth from one place. `@/lib/time`
// deliberately re-exports only the pure half — see the note there.
import 'server-only'
import { prisma } from '@/lib/prisma'
import {
  cleanIanaTimeZone,
  cleanTimeZoneLookupId,
  resolveApptTimeZoneFromValues,
  resolveLocationId,
  type TimeZoneTruthArgs,
  type TimeZoneTruthResult,
  type AppointmentSchedulingContextResult,
} from '@/lib/booking/timeZoneTruthValues'

export {
  resolveApptTimeZoneFromValues,
  resolveSchedulingTimeZoneFromValues,
} from '@/lib/booking/timeZoneTruthValues'
export type {
  TimeZoneTruthSource,
  TimeZoneTruthArgs,
  TimeZoneTruthResult,
  AppointmentSchedulingContext,
  AppointmentSchedulingContextResult,
} from '@/lib/booking/timeZoneTruthValues'

/**
 * Resolver that may look up the location timezone if only locationId/professionalId
 * are available. This keeps timezone precedence centralized for server-side scheduling.
 */
export async function resolveApptTimeZone(args: TimeZoneTruthArgs): Promise<TimeZoneTruthResult> {
  const direct = resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    holdLocationTimeZone: args.holdLocationTimeZone,
    locationTimeZone: args.locationTimeZone ?? args.location?.timeZone,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback,
    requireValid: false,
  })

  if (direct.ok && direct.source !== 'FALLBACK') {
    return direct
  }

  const locationId = cleanTimeZoneLookupId(args.locationId)
  const professionalId = cleanTimeZoneLookupId(args.professionalId)

  if (locationId && professionalId) {
    const location = await prisma.professionalLocation.findFirst({
      where: { id: locationId, professionalId },
      select: { timeZone: true },
    })

    const fetchedLocationTz = cleanIanaTimeZone(location?.timeZone)
    if (fetchedLocationTz) {
      return { ok: true, timeZone: fetchedLocationTz, source: 'LOCATION' }
    }
  }

  return resolveApptTimeZoneFromValues({
    bookingLocationTimeZone: args.bookingLocationTimeZone,
    holdLocationTimeZone: args.holdLocationTimeZone,
    locationTimeZone: args.locationTimeZone ?? args.location?.timeZone,
    professionalTimeZone: args.professionalTimeZone,
    fallback: args.fallback,
    requireValid: args.requireValid,
  })
}

/**
 * Strict async scheduling resolver that may fetch location timezone if needed.
 */
export async function resolveSchedulingTimeZone(
  args: Omit<TimeZoneTruthArgs, 'requireValid'>
): Promise<TimeZoneTruthResult> {
  return resolveApptTimeZone({ ...args, requireValid: true })
}

/**
 * Shared scheduling context for routes that need more than a timezone string.
 *
 * Server-side scheduling math should use `appointmentTimeZone` from this context.
 * UI may display other converted values, but should not invent scheduling truth.
 */
export async function resolveAppointmentSchedulingContext(
  args: TimeZoneTruthArgs
): Promise<AppointmentSchedulingContextResult> {
  const tzResult = await resolveApptTimeZone(args)
  if (!tzResult.ok) {
    return tzResult
  }

  const locationId = resolveLocationId(args)

  const locationTimeZone =
    tzResult.source === 'LOCATION'
      ? tzResult.timeZone
      : cleanIanaTimeZone(args.locationTimeZone ?? args.location?.timeZone)

  const businessTimeZone = cleanIanaTimeZone(args.professionalTimeZone)

  return {
    ok: true,
    context: {
      appointmentTimeZone: tzResult.timeZone,
      timeZoneSource: tzResult.source,
      locationId,
      locationTimeZone,
      businessTimeZone,
    },
  }
}
