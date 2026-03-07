// lib/booking/conflictQueries.ts

/**
 * Booking / availability conflict contract
 *
 * This file is the single source of truth for overlap behavior:
 *
 * - Bookings are PRO-WIDE occupancy.
 *   A professional cannot be double-booked across different locations
 *   or across different booking modes (SALON vs MOBILE) at the same time.
 *
 * - Holds are also PRO-WIDE occupancy.
 *   A held time blocks that professional regardless of the client-facing mode/location view.
 *
 * - Calendar blocks are LOCATION-AWARE or GLOBAL.
 *   A block only applies when:
 *   - it matches the selected locationId, or
 *   - it is global (locationId === null).
 *
 * - Client-facing availability is LOCATION/MODE-SCOPED for visibility,
 *   but must still consume PRO-WIDE booking and hold occupancy when determining
 *   whether a slot is actually free.
 *
 * If you change these rules, update the tests first.
 */
import { prisma } from '@/lib/prisma'
import { BookingStatus, Prisma } from '@prisma/client'
import {
  type BusyInterval,
  bookingToBusyInterval,
  bufferOrZero,
  getConflictWindowStart,
  holdToBusyInterval,
  mergeBusyIntervals,
  overlaps,
} from '@/lib/booking/conflicts'
import { DEFAULT_DURATION_MINUTES } from '@/lib/booking/constants'

type DbClient = Prisma.TransactionClient | typeof prisma

type CalendarBlockConflictArgs = {
  tx?: DbClient
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
}

type BookingConflictCheckArgs = {
  tx?: DbClient
  professionalId: string
  requestedStart: Date
  requestedEnd: Date
  excludeBookingId?: string | null
  take?: number
}

type HoldConflictCheckArgs = {
  tx?: DbClient
  professionalId: string
  requestedStart: Date
  requestedEnd: Date
  defaultBufferMinutes: number
  fallbackDurationMinutes?: number
  excludeHoldId?: string | null
  nowUtc?: Date
  take?: number
}

type TimeRangeAvailabilityArgs = {
  tx?: DbClient
  professionalId: string
  locationId: string
  requestedStart: Date
  requestedEnd: Date
  defaultBufferMinutes: number
  fallbackDurationMinutes?: number
  excludeBookingId?: string | null
  excludeHoldId?: string | null
  nowUtc?: Date
  take?: number
}

type BusyIntervalWindowArgs = {
  tx?: DbClient
  professionalId: string
  locationId: string
  windowStartUtc: Date
  windowEndUtc: Date
  nowUtc?: Date
  fallbackDurationMinutes?: number
  defaultBufferMinutes: number
  take?: number
}

function db(tx?: DbClient): DbClient {
  return tx ?? prisma
}

function normalizeTake(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback

  const whole = Math.trunc(parsed)
  if (whole < 1) return fallback

  return Math.min(whole, 10_000)
}

export async function findCalendarBlockConflict(
  args: CalendarBlockConflictArgs,
) {
  const { tx, professionalId, locationId, requestedStart, requestedEnd } = args

  return db(tx).calendarBlock.findFirst({
    where: {
      professionalId,
      startsAt: { lt: requestedEnd },
      endsAt: { gt: requestedStart },
      OR: [{ locationId }, { locationId: null }],
    },
    select: { id: true },
  })
}

export async function hasBookingConflict(
  args: BookingConflictCheckArgs,
): Promise<boolean> {
  const {
    tx,
    professionalId,
    requestedStart,
    requestedEnd,
    excludeBookingId = null,
    take = 2000,
  } = args

  const rows = await db(tx).booking.findMany({
    where: {
      professionalId,
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      scheduledFor: {
        gte: getConflictWindowStart(requestedStart),
        lt: requestedEnd,
      },
      status: { not: BookingStatus.CANCELLED },
    },
    select: {
      scheduledFor: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
    },
    take: normalizeTake(take, 2000),
  })

  return rows.some((row) => {
    const interval = bookingToBusyInterval(row)
    return overlaps(interval.start, interval.end, requestedStart, requestedEnd)
  })
}

export async function hasHoldConflict(
  args: HoldConflictCheckArgs,
): Promise<boolean> {
  const {
    tx,
    professionalId,
    requestedStart,
    requestedEnd,
    defaultBufferMinutes,
    fallbackDurationMinutes = DEFAULT_DURATION_MINUTES,
    excludeHoldId = null,
    nowUtc = new Date(),
    take = 2000,
  } = args

  const holds = await db(tx).bookingHold.findMany({
    where: {
      professionalId,
      ...(excludeHoldId ? { id: { not: excludeHoldId } } : {}),
      expiresAt: { gt: nowUtc },
      scheduledFor: {
        gte: getConflictWindowStart(requestedStart),
        lt: requestedEnd,
      },
    },
    select: {
      id: true,
      scheduledFor: true,
      offeringId: true,
      locationId: true,
      locationType: true,
    },
    take: normalizeTake(take, 2000),
  })

  if (!holds.length) return false

  const offeringIds = Array.from(new Set(holds.map((hold) => hold.offeringId)))
  const locationIds = Array.from(
    new Set(
      holds
        .map((hold) => hold.locationId)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    ),
  )

  const [offerings, locations] = await Promise.all([
    offeringIds.length
      ? db(tx).professionalServiceOffering.findMany({
          where: { id: { in: offeringIds } },
          select: {
            id: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
          take: normalizeTake(take, 2000),
        })
      : Promise.resolve([]),
    locationIds.length
      ? db(tx).professionalLocation.findMany({
          where: { id: { in: locationIds } },
          select: {
            id: true,
            bufferMinutes: true,
          },
          take: normalizeTake(take, 2000),
        })
      : Promise.resolve([]),
  ])

  const offeringById = new Map(offerings.map((row) => [row.id, row]))
  const bufferByLocationId = new Map(
    locations.map((row) => [row.id, bufferOrZero(row.bufferMinutes)]),
  )

  return holds.some((hold) => {
    const offering = offeringById.get(hold.offeringId)
    const bufferMinutes =
      (hold.locationId ? bufferByLocationId.get(hold.locationId) : undefined) ??
      bufferOrZero(defaultBufferMinutes)

    const interval = holdToBusyInterval({
      hold,
      salonDurationMinutes: offering?.salonDurationMinutes,
      mobileDurationMinutes: offering?.mobileDurationMinutes,
      fallbackDurationMinutes,
      bufferMinutes,
    })

    return overlaps(interval.start, interval.end, requestedStart, requestedEnd)
  })
}

export async function assertNoCalendarBlockConflict(
  args: CalendarBlockConflictArgs,
): Promise<void> {
  const conflict = await findCalendarBlockConflict(args)
  if (conflict) {
    throw new Error('BLOCKED')
  }
}

export async function assertNoBookingConflict(
  args: BookingConflictCheckArgs,
): Promise<void> {
  const conflict = await hasBookingConflict(args)
  if (conflict) {
    throw new Error('TIME_NOT_AVAILABLE')
  }
}

export async function assertNoHoldConflict(
  args: HoldConflictCheckArgs,
): Promise<void> {
  const conflict = await hasHoldConflict(args)
  if (conflict) {
    throw new Error('TIME_NOT_AVAILABLE')
  }
}

export async function assertTimeRangeAvailable(
  args: TimeRangeAvailabilityArgs,
): Promise<void> {
  await assertNoCalendarBlockConflict(args)
  await assertNoBookingConflict(args)
  await assertNoHoldConflict(args)
}

export async function loadBusyIntervalsForWindow(
  args: BusyIntervalWindowArgs,
): Promise<BusyInterval[]> {
  const {
    tx,
    professionalId,
    locationId,
    windowStartUtc,
    windowEndUtc,
    nowUtc = new Date(),
    fallbackDurationMinutes = DEFAULT_DURATION_MINUTES,
    defaultBufferMinutes,
    take = 5000,
  } = args

  const database = db(tx)
  const normalizedTake = normalizeTake(take, 5000)
  const queryStartUtc = getConflictWindowStart(windowStartUtc)

  const [bookings, holds, blocks] = await Promise.all([
    database.booking.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: queryStartUtc, lt: windowEndUtc },
        status: { not: BookingStatus.CANCELLED },
      },
      select: {
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
      },
      take: normalizedTake,
    }),
    database.bookingHold.findMany({
      where: {
        professionalId,
        scheduledFor: { gte: queryStartUtc, lt: windowEndUtc },
        expiresAt: { gt: nowUtc },
      },
      select: {
        id: true,
        scheduledFor: true,
        offeringId: true,
        locationId: true,
        locationType: true,
      },
      take: normalizedTake,
    }),
    database.calendarBlock.findMany({
      where: {
        professionalId,
        startsAt: { lt: windowEndUtc },
        endsAt: { gt: windowStartUtc },
        OR: [{ locationId: null }, { locationId }],
      },
      select: {
        startsAt: true,
        endsAt: true,
      },
      take: normalizedTake,
    }),
  ])

  const holdOfferingIds = Array.from(new Set(holds.map((hold) => hold.offeringId)))
  const holdLocationIds = Array.from(
    new Set(
      holds
        .map((hold) => hold.locationId)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    ),
  )

  const [holdOfferings, holdLocations] = await Promise.all([
    holdOfferingIds.length
      ? database.professionalServiceOffering.findMany({
          where: { id: { in: holdOfferingIds } },
          select: {
            id: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
          take: normalizedTake,
        })
      : Promise.resolve([]),
    holdLocationIds.length
      ? database.professionalLocation.findMany({
          where: { id: { in: holdLocationIds } },
          select: {
            id: true,
            bufferMinutes: true,
          },
          take: normalizedTake,
        })
      : Promise.resolve([]),
  ])

  const holdOfferingById = new Map(holdOfferings.map((row) => [row.id, row]))
  const holdBufferByLocationId = new Map(
    holdLocations.map((row) => [row.id, bufferOrZero(row.bufferMinutes)]),
  )

  const intervals: BusyInterval[] = [
    ...bookings.map((booking) =>
      bookingToBusyInterval(booking, fallbackDurationMinutes),
    ),
    ...holds.map((hold) => {
      const offering = holdOfferingById.get(hold.offeringId)
      const bufferMinutes =
        (hold.locationId ? holdBufferByLocationId.get(hold.locationId) : undefined) ??
        bufferOrZero(defaultBufferMinutes)

      return holdToBusyInterval({
        hold,
        salonDurationMinutes: offering?.salonDurationMinutes,
        mobileDurationMinutes: offering?.mobileDurationMinutes,
        fallbackDurationMinutes,
        bufferMinutes,
      })
    }),
    ...blocks.map((block) => ({
      start: new Date(block.startsAt),
      end: new Date(block.endsAt),
    })),
  ]

  return mergeBusyIntervals(intervals)
}