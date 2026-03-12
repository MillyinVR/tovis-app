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

type TimeRangeConflictCode = 'BLOCKED' | 'BOOKING' | 'HOLD'

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
      offering: {
        select: {
          id: true,
          salonDurationMinutes: true,
          mobileDurationMinutes: true,
        },
      },
      location: {
        select: {
          id: true,
          bufferMinutes: true,
        },
      },
    },
    take: normalizeTake(take, 2000),
  })

  if (!holds.length) return false

  return holds.some((hold) => {
    const bufferMinutes =
      (hold.location ? bufferOrZero(hold.location.bufferMinutes) : undefined) ??
      bufferOrZero(defaultBufferMinutes)

    const interval = holdToBusyInterval({
      hold,
      salonDurationMinutes: hold.offering?.salonDurationMinutes,
      mobileDurationMinutes: hold.offering?.mobileDurationMinutes,
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
  const conflict = await getTimeRangeConflict(args)

  if (conflict === 'BLOCKED') {
    throw new Error('BLOCKED')
  }

  if (conflict === 'BOOKING' || conflict === 'HOLD') {
    throw new Error('TIME_NOT_AVAILABLE')
  }
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
        offering: {
          select: {
            id: true,
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
        },
        location: {
          select: {
            id: true,
            bufferMinutes: true,
          },
        },
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

  const intervals: BusyInterval[] = [
    ...bookings.map((booking) =>
      bookingToBusyInterval(booking, fallbackDurationMinutes),
    ),
    ...holds.map((hold) => {
      const bufferMinutes =
        (hold.location ? bufferOrZero(hold.location.bufferMinutes) : undefined) ??
        bufferOrZero(defaultBufferMinutes)

      return holdToBusyInterval({
        hold,
        salonDurationMinutes: hold.offering?.salonDurationMinutes,
        mobileDurationMinutes: hold.offering?.mobileDurationMinutes,
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
export async function getTimeRangeConflict(
  args: TimeRangeAvailabilityArgs,
): Promise<TimeRangeConflictCode | null> {
  const {
    tx,
    professionalId,
    locationId,
    requestedStart,
    requestedEnd,
    defaultBufferMinutes,
    fallbackDurationMinutes,
    excludeBookingId,
    excludeHoldId,
    nowUtc,
    take,
  } = args

  // Run all three conflict checks concurrently
  const [blockConflict, bookingConflict, holdConflict] = await Promise.all([
    findCalendarBlockConflict({
      tx,
      professionalId,
      locationId,
      requestedStart,
      requestedEnd,
    }),
    hasBookingConflict({
      tx,
      professionalId,
      requestedStart,
      requestedEnd,
      excludeBookingId,
      take,
    }),
    hasHoldConflict({
      tx,
      professionalId,
      requestedStart,
      requestedEnd,
      defaultBufferMinutes,
      fallbackDurationMinutes,
      excludeHoldId,
      nowUtc,
      take,
    }),
  ])

  if (blockConflict) return 'BLOCKED'
  if (bookingConflict) return 'BOOKING'
  if (holdConflict) return 'HOLD'

  return null
}