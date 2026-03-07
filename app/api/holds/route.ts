// app/api/holds/route.ts
import { NextRequest } from 'next/server'
import { Prisma, ServiceLocationType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requireClient } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { HOLD_MINUTES } from '@/lib/booking/constants'
import { addMinutes, normalizeToMinute } from '@/lib/booking/conflicts'
import {
  findCalendarBlockConflict,
  hasBookingConflict,
  hasHoldConflict,
} from '@/lib/booking/conflictQueries'
import {
  normalizeLocationType,
  pickModeDurationMinutes,
  resolveBookingLocationContext,
} from '@/lib/booking/locationContext'
import { buildAddressSnapshot } from '@/lib/booking/snapshots'
import { minutesSinceMidnightInTimeZone } from '@/lib/timeZone'
import { ensureWithinWorkingHours } from '@/lib/booking/workingHoursGuard'

export const dynamic = 'force-dynamic'

function isValidDate(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime())
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const clientId = auth.clientId

    const rawBody: unknown = await req.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const offeringId = pickString(body.offeringId)
    const requestedLocationId = pickString(body.locationId)
    const locationType = normalizeLocationType(body.locationType)
    const scheduledForRaw = pickString(body.scheduledFor)

    if (!offeringId || !scheduledForRaw || !locationType) {
      return jsonFail(400, 'Missing offeringId, scheduledFor, or locationType.')
    }

    const scheduledForParsed = new Date(scheduledForRaw)
    if (!isValidDate(scheduledForParsed)) {
      return jsonFail(400, 'Invalid scheduledFor.')
    }

    const now = new Date()
    const requestedStart = normalizeToMinute(scheduledForParsed)

    if (requestedStart.getTime() < now.getTime() + 60_000) {
      return jsonFail(400, 'Please select a future time.')
    }

    const offering = await prisma.professionalServiceOffering.findUnique({
      where: { id: offeringId },
      select: {
        id: true,
        isActive: true,
        professionalId: true,
        offersInSalon: true,
        offersMobile: true,
        salonDurationMinutes: true,
        mobileDurationMinutes: true,
      },
    })

    if (!offering || !offering.isActive) {
      return jsonFail(404, 'Offering not found.')
    }

    if (
      locationType === ServiceLocationType.SALON &&
      !offering.offersInSalon
    ) {
      return jsonFail(400, 'This service is not available in-salon.')
    }

    if (
      locationType === ServiceLocationType.MOBILE &&
      !offering.offersMobile
    ) {
      return jsonFail(400, 'This service is not available for mobile.')
    }

    const result = await prisma.$transaction(async (tx) => {
      const locationContextResult = await resolveBookingLocationContext({
        tx,
        professionalId: offering.professionalId,
        requestedLocationId,
        locationType,
        fallbackTimeZone: 'UTC',
        requireValidTimeZone: true,
      })

      if (!locationContextResult.ok) {
        if (locationContextResult.error === 'LOCATION_NOT_FOUND') {
          return {
            ok: false as const,
            status: 404,
            error: 'Location not found or not bookable.',
          }
        }

        return {
          ok: false as const,
          status: 400,
          error: 'This professional must set a valid timezone before taking bookings.',
        }
      }

      const locationContext = locationContextResult.context

      const durationMinutes = pickModeDurationMinutes({
        locationType,
        salonDurationMinutes: offering.salonDurationMinutes,
        mobileDurationMinutes: offering.mobileDurationMinutes,
      })

      const requestedEnd = addMinutes(
        requestedStart,
        durationMinutes + locationContext.bufferMinutes,
      )

      if (
        requestedStart.getTime() <
        now.getTime() + locationContext.advanceNoticeMinutes * 60_000
      ) {
        return {
          ok: false as const,
          status: 400,
          error: 'Please pick a later time.',
        }
      }

      if (
        requestedStart.getTime() >
        now.getTime() + locationContext.maxDaysAhead * 24 * 60 * 60_000
      ) {
        return {
          ok: false as const,
          status: 400,
          error: 'That date is too far in the future.',
        }
      }

      const startMinuteOfDay = minutesSinceMidnightInTimeZone(
        requestedStart,
        locationContext.timeZone,
      )

      if (startMinuteOfDay % locationContext.stepMinutes !== 0) {
        return {
          ok: false as const,
          status: 400,
          error: `Start time must be on a ${locationContext.stepMinutes}-minute boundary.`,
        }
      }

      const workingHoursCheck = ensureWithinWorkingHours({
        scheduledStartUtc: requestedStart,
        scheduledEndUtc: requestedEnd,
        workingHours: locationContext.workingHours,
        timeZone: locationContext.timeZone,
        fallbackTimeZone: 'UTC',
        messages: {
          missing: 'This professional has not set working hours yet.',
          outside: 'That time is outside this professional’s working hours.',
          misconfigured: 'This professional’s working hours are misconfigured.',
        },
      })

      if (!workingHoursCheck.ok) {
        return {
          ok: false as const,
          status: 400,
          error: workingHoursCheck.error,
        }
      }

      const blockConflict = await findCalendarBlockConflict({
        tx,
        professionalId: offering.professionalId,
        locationId: locationContext.locationId,
        requestedStart,
        requestedEnd,
      })

      if (blockConflict) {
        return {
          ok: false as const,
          status: 409,
          error: 'That time is blocked. Try another slot.',
        }
      }

      const bookingConflict = await hasBookingConflict({
        tx,
        professionalId: offering.professionalId,
        requestedStart,
        requestedEnd,
      })

      if (bookingConflict) {
        return {
          ok: false as const,
          status: 409,
          error: 'That time was just taken.',
        }
      }

      const holdConflict = await hasHoldConflict({
        tx,
        professionalId: offering.professionalId,
        requestedStart,
        requestedEnd,
        defaultBufferMinutes: locationContext.bufferMinutes,
        fallbackDurationMinutes: durationMinutes,
      })

      if (holdConflict) {
        return {
          ok: false as const,
          status: 409,
          error: 'Someone is already holding that time. Try another slot.',
        }
      }

      const expiresAt = addMinutes(now, HOLD_MINUTES)
      const addressSnapshot: Prisma.InputJsonValue | undefined =
        buildAddressSnapshot(locationContext.formattedAddress)

      try {
        const hold = await tx.bookingHold.create({
          data: {
            offeringId: offering.id,
            professionalId: offering.professionalId,
            clientId,
            scheduledFor: requestedStart,
            expiresAt,
            locationType,
            locationId: locationContext.locationId,
            locationTimeZone: locationContext.timeZone,
            locationAddressSnapshot: addressSnapshot,
            locationLatSnapshot: locationContext.lat,
            locationLngSnapshot: locationContext.lng,
          },
          select: {
            id: true,
            expiresAt: true,
            scheduledFor: true,
            locationType: true,
            locationId: true,
            locationTimeZone: true,
          },
        })

        return { ok: true as const, status: 201, hold }
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return {
            ok: false as const,
            status: 409,
            error: 'Someone is already holding that time. Try another slot.',
          }
        }

        throw error
      }
    })

    if (!result.ok) {
      return jsonFail(result.status, result.error)
    }

    return jsonOk({ hold: result.hold }, result.status)
  } catch (error) {
    console.error('POST /api/holds error', error)
    return jsonFail(500, 'Failed to create hold.')
  }
}