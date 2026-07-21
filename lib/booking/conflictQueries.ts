// lib/booking/conflictQueries.ts

/**
 * Booking / availability conflict contract
 *
 * Single source of truth for overlap behavior:
 *
 * 1) Bookings are PRO-WIDE occupancy.
 *    A professional cannot be double-booked across locations or booking modes.
 *
 * 2) Holds are PRO-WIDE occupancy.
 *    An active hold blocks that professional regardless of client-facing view.
 *
 * 3) Calendar blocks are LOCATION-AWARE or GLOBAL.
 *    - global block => conflicts everywhere
 *    - location block => conflicts only for that location
 *
 * 4) WAITLIST DOES NOT BLOCK TIME.
 *    Waitlist is non-occupancy metadata, not a reservation.
 *
 * If these rules change, update tests first.
 */

import { prisma } from '@/lib/prisma'
import { Prisma, ServiceLocationType } from '@prisma/client'
import {
  addMinutes,
  type BusyInterval,
  bookingToBusyInterval,
  bufferOrZero,
  getConflictWindowStart,
  holdToBusyInterval,
  mergeBusyIntervals,
  overlaps,
  sqlBusyWindowMinutes,
} from '@/lib/booking/conflicts'
import {
  BOOKING_BLOCKING_STATUSES,
  DEFAULT_DURATION_MINUTES,
} from '@/lib/booking/constants'
import type { SchedulingConflict } from '@/lib/booking/overlapPolicy'

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

export type TimeRangeConflictCode = 'BLOCKED' | 'BOOKING' | 'HOLD'

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

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function normalizeSnapshotMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const whole = Math.trunc(value)
  return whole >= 0 ? whole : null
}

export type HoldBusyIntervalRecord = {
  scheduledFor: Date
  locationType: ServiceLocationType
  endsAtSnapshot?: Date | null
  durationMinutesSnapshot?: number | null
  bufferMinutesSnapshot?: number | null
  offering?: {
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
  } | null
  location?: {
    bufferMinutes: number | null
  } | null
}

/**
 * THE hold busy-window builder. Both the availability reads and the
 * write-boundary overlap gate go through this one function, so they can never
 * disagree on how much time a hold occupies (they used to: see
 * conflictEngineParity.test.ts).
 *
 * Whatever branch it takes, the returned window is floored to the durable
 * database EXCLUDE range for that row —
 * `tovis_booking_overlap_range(scheduledFor, durationMinutesSnapshot,
 * bufferMinutesSnapshot)` = GREATEST(1, dur + buf). Note the constraint keys off
 * the SNAPSHOT COLUMNS, not `endsAtSnapshot`, so a row whose `endsAtSnapshot` is
 * shorter than its own duration+buffer (or a legacy row predating those columns)
 * would otherwise let this builder clear a slot Postgres then rejects with a
 * 23P01. Pinned against the real SQL function by
 * tests/integration/busy-window-sql-parity.test.ts.
 */
export function holdRecordToBusyInterval(args: {
  hold: HoldBusyIntervalRecord
  defaultBufferMinutes: number
  fallbackDurationMinutes: number
}): BusyInterval {
  const start = new Date(args.hold.scheduledFor)

  // The database floor for THIS row, computed from the same two columns the
  // EXCLUDE constraint reads. Every branch below is clamped up to it, measured
  // from that branch's own start so the legacy fallback keeps its floored start.
  const atLeastSqlFloor = (interval: BusyInterval): BusyInterval => {
    const floorEnd = addMinutes(
      interval.start,
      sqlBusyWindowMinutes(
        args.hold.durationMinutesSnapshot,
        args.hold.bufferMinutesSnapshot,
      ),
    )

    return {
      start: interval.start,
      end: interval.end.getTime() < floorEnd.getTime() ? floorEnd : interval.end,
    }
  }

  if (isValidDate(args.hold.endsAtSnapshot)) {
    return atLeastSqlFloor({
      start,
      end: new Date(args.hold.endsAtSnapshot),
    })
  }

  const durationMinutes = normalizeSnapshotMinutes(
    args.hold.durationMinutesSnapshot,
  )
  const bufferMinutesSnapshot = normalizeSnapshotMinutes(
    args.hold.bufferMinutesSnapshot,
  )

  if (durationMinutes != null) {
    return atLeastSqlFloor({
      start,
      end: addMinutes(start, durationMinutes + (bufferMinutesSnapshot ?? 0)),
    })
  }

  const legacyBufferMinutes =
    (args.hold.location
      ? bufferOrZero(args.hold.location.bufferMinutes)
      : undefined) ?? bufferOrZero(args.defaultBufferMinutes)

  return atLeastSqlFloor(
    holdToBusyInterval({
      hold: args.hold,
      salonDurationMinutes: args.hold.offering?.salonDurationMinutes,
      mobileDurationMinutes: args.hold.offering?.mobileDurationMinutes,
      fallbackDurationMinutes: args.fallbackDurationMinutes,
      bufferMinutes: legacyBufferMinutes,
    }),
  )
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

function buildBlockingBookingStatusWhere(): Prisma.BookingWhereInput {
  return {
    status: {
      in: [...BOOKING_BLOCKING_STATUSES],
    },
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

function toConflictErrorCode(
  conflict: TimeRangeConflictCode,
): 'TIME_BLOCKED' | 'TIME_BOOKED' | 'TIME_HELD' {
  switch (conflict) {
    case 'BLOCKED':
      return 'TIME_BLOCKED'
    case 'BOOKING':
      return 'TIME_BOOKED'
    case 'HOLD':
      return 'TIME_HELD'
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
      ...buildBlockingBookingStatusWhere(),
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
      endsAtSnapshot: true,
      durationMinutesSnapshot: true,
      bufferMinutesSnapshot: true,
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
    const interval = holdRecordToBusyInterval({
      hold,
      defaultBufferMinutes,
      fallbackDurationMinutes,
    })

    return overlaps(interval.start, interval.end, requestedStart, requestedEnd)
  })
}

/**
 * The write-boundary overlap gate's view of a requested window: the LIST of
 * conflicting bookings and holds, not just a verdict.
 *
 * `getTimeRangeConflict` answers "is this window free?" with a single
 * highest-priority code, which is all a client-facing refusal needs. The overlap
 * policy needs more: `decideBookingOverlapPermission` takes the conflicts
 * themselves, because the decision drives `allowsOverlap` (does this row leave
 * the GIST index?) and the `conflictKinds` on the blocked-decision audit log.
 * This is that shape, built on the SAME primitives as every other conflict read
 * so the two can never drift apart again.
 *
 * CALENDAR BLOCKS ARE DELIBERATELY ABSENT. `SchedulingConflictKind` is
 * BOOKING | HOLD only: blocks are gated one layer up, in
 * `evaluateProSchedulingDecision`, which treats BLOCKED as fatal and then defers
 * booking/hold to the overlap policy. Re-deriving that gate here would duplicate
 * it, not consolidate it.
 */
export async function findBookingAndHoldConflicts(args: {
  tx?: DbClient
  professionalId: string
  startsAt: Date
  endsAt: Date
  excludeBookingId?: string | null
  excludeHoldId?: string | null
  defaultBufferMinutes?: number
  fallbackDurationMinutes?: number
  now?: Date
  take?: number
}): Promise<{
  bookings: SchedulingConflict[]
  holds: SchedulingConflict[]
  all: SchedulingConflict[]
}> {
  const {
    tx,
    professionalId,
    startsAt,
    endsAt,
    excludeBookingId = null,
    excludeHoldId = null,
    defaultBufferMinutes = 0,
    fallbackDurationMinutes = DEFAULT_DURATION_MINUTES,
    now = new Date(),
    // No default cap. Sibling readers take 2000 because they answer a boolean;
    // this one is the gate a booking write passes through, and a silently
    // truncated conflict list there is a double-book.
    take,
  } = args

  // A non-positive window can never overlap anything, and the callers treat
  // "no conflicts" as the answer. Returning empty (rather than throwing
  // INVALID_RANGE like the assert-style readers) keeps that contract.
  if (!(endsAt.getTime() > startsAt.getTime())) {
    return { bookings: [], holds: [], all: [] }
  }

  const database = db(tx)
  const queryStart = getConflictWindowStart(startsAt)

  const [bookingRows, holdRows] = await Promise.all([
    database.booking.findMany({
      where: {
        professionalId,
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        scheduledFor: { gte: queryStart, lt: endsAt },
        ...buildBlockingBookingStatusWhere(),
      },
      select: {
        id: true,
        professionalId: true,
        scheduledFor: true,
        totalDurationMinutes: true,
        bufferMinutes: true,
      },
      ...(take === undefined ? {} : { take: normalizeTake(take, 2000) }),
    }),
    database.bookingHold.findMany({
      where: {
        professionalId,
        ...(excludeHoldId ? { id: { not: excludeHoldId } } : {}),
        expiresAt: { gt: now },
        scheduledFor: { gte: queryStart, lt: endsAt },
      },
      select: {
        id: true,
        professionalId: true,
        scheduledFor: true,
        endsAtSnapshot: true,
        durationMinutesSnapshot: true,
        bufferMinutesSnapshot: true,
        locationType: true,
        offering: {
          select: {
            salonDurationMinutes: true,
            mobileDurationMinutes: true,
          },
        },
        location: {
          select: {
            bufferMinutes: true,
          },
        },
      },
      ...(take === undefined ? {} : { take: normalizeTake(take, 2000) }),
    }),
  ])

  const overlapsRequested = (conflict: SchedulingConflict): boolean =>
    overlaps(conflict.startsAt, conflict.endsAt, startsAt, endsAt)

  const bookings = bookingRows
    .map((row): SchedulingConflict => {
      const interval = bookingToBusyInterval(row, fallbackDurationMinutes)
      return {
        kind: 'BOOKING',
        id: row.id,
        professionalId: row.professionalId,
        startsAt: interval.start,
        endsAt: interval.end,
      }
    })
    .filter(overlapsRequested)

  const holds = holdRows
    .map((row): SchedulingConflict => {
      const interval = holdRecordToBusyInterval({
        hold: row,
        defaultBufferMinutes,
        fallbackDurationMinutes,
      })
      return {
        kind: 'HOLD',
        id: row.id,
        professionalId: row.professionalId,
        startsAt: interval.start,
        endsAt: interval.end,
      }
    })
    .filter(overlapsRequested)

  const all = [...bookings, ...holds].sort(
    (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
  )

  return { bookings, holds, all }
}

export async function assertNoCalendarBlockConflict(
  args: CalendarBlockConflictArgs,
): Promise<void> {
  const conflict = await findCalendarBlockConflict(args)
  if (conflict) {
    throw new Error('TIME_BLOCKED')
  }
}

export async function assertNoBookingConflict(
  args: BookingConflictCheckArgs,
): Promise<void> {
  const conflict = await hasBookingConflict(args)
  if (conflict) {
    throw new Error('TIME_BOOKED')
  }
}

export async function assertNoHoldConflict(
  args: HoldConflictCheckArgs,
): Promise<void> {
  const conflict = await hasHoldConflict(args)
  if (conflict) {
    throw new Error('TIME_HELD')
  }
}

export async function assertTimeRangeAvailable(
  args: TimeRangeAvailabilityArgs,
): Promise<void> {
  const conflict = await getTimeRangeConflict(args)

  if (!conflict) return

  throw new Error(toConflictErrorCode(conflict))
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
        ...buildBlockingBookingStatusWhere(),
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
        endsAtSnapshot: true,
        durationMinutesSnapshot: true,
        bufferMinutesSnapshot: true,
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
    ...holds.map((hold) =>
      holdRecordToBusyInterval({
        hold,
        defaultBufferMinutes,
        fallbackDurationMinutes,
      }),
    ),
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