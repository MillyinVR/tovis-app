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
 *   A block applies when:
 *   - it is global (locationId === null), or
 *   - it matches the selected/requested locationId.
 *
 *   Important nuance:
 *   - A REQUESTED global block conflicts with ANY overlapping block for that pro.
 *   - A REQUESTED location-scoped block conflicts with overlapping global blocks
 *     and overlapping blocks for that same location.
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
  locationId: string | null
  requestedStart: Date
  requestedEnd: Date
  excludeBlockId?: string | null
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
  locationId: string | null
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
  locationId: string | null
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

function assertValidRange(start: Date, end: Date): void {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new Error('INVALID_START')
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new Error('INVALID_END')
  }
  if (end <= start) {
    throw new Error('INVALID_RANGE')
  }
}

/**
 * Existing block applicability when evaluating a requested block/time range:
 *
 * - requested locationId === null (global request):
 *   any overlapping block for this pro conflicts
 *
 * - requested locationId !== null (location-scoped request):
 *   overlapping global blocks conflict
 *   overlapping blocks at the same location conflict
 */
function buildCalendarBlockConflictWhere(args: {
  professionalId: string
  locationId: string | null
  requestedStart: Date
  requestedEnd: Date
  excludeBlockId?: string | null
}): Prisma.CalendarBlockWhereInput {
  const {
    professionalId,
    locationId,
    requestedStart,
    requestedEnd,
    excludeBlockId = null,
  } = args

  return {
    professionalId,
    ...(excludeBlockId ? { id: { not: excludeBlockId } } : {}),
    startsAt: { lt: requestedEnd },
    endsAt: { gt: requestedStart },
    ...(locationId === null
      ? {}
      : {
          OR: [{ locationId: null }, { locationId }],
        }),
  }
}

/**
 * Existing block applicability when loading busy intervals for a selected location:
 *
 * - selected locationId === null:
 *   include all overlapping blocks for this pro
 *
 * - selected locationId !== null:
 *   include overlapping global blocks and blocks for that location
 */
function buildCalendarBlockWindowWhere(args: {
  professionalId: string
  locationId: string | null
  windowStartUtc: Date
  windowEndUtc: Date
}): Prisma.CalendarBlockWhereInput {
  const { professionalId, locationId, windowStartUtc, windowEndUtc } = args

  return {
    professionalId,
    startsAt: { lt: windowEndUtc },
    endsAt: { gt: windowStartUtc },
    ...(locationId === null
      ? {}
      : {
          OR: [{ locationId: null }, { locationId }],
        }),
  }
}

export async function findCalendarBlockConflict(
  args: CalendarBlockConflictArgs,
) {
  const {
    tx,
    professionalId,
    locationId,
    requestedStart,
    requestedEnd,
    excludeBlockId = null,
  } = args

  assertValidRange(requestedStart, requestedEnd)

  return db(tx).calendarBlock.findFirst({
    where: buildCalendarBlockConflictWhere({
      professionalId,
      locationId,
      requestedStart,
      requestedEnd,
      excludeBlockId,
    }),
    select: { id: true },
  })
}

export async function hasCalendarBlockConflict(
  args: CalendarBlockConflictArgs,
): Promise<boolean> {
  const conflict = await findCalendarBlockConflict(args)
  return Boolean(conflict)
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

  assertValidRange(requestedStart, requestedEnd)

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

  assertValidRange(requestedStart, requestedEnd)

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

  assertValidRange(windowStartUtc, windowEndUtc)

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
      where: buildCalendarBlockWindowWhere({
        professionalId,
        locationId,
        windowStartUtc,
        windowEndUtc,
      }),
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

  assertValidRange(requestedStart, requestedEnd)

  const [blockConflict, bookingConflict, holdConflict] = await Promise.all([
    hasCalendarBlockConflict({
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