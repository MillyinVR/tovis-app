// lib/booking/schedulingConflicts.ts

import { type Prisma } from '@prisma/client'

import type { SchedulingConflict } from './overlapPolicy'
import {
  bookingToBusyInterval,
  getConflictWindowStart,
  sqlBusyWindowMinutes,
} from '@/lib/booking/conflicts'
import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'
export type PrismaTransactionClient = Prisma.TransactionClient

export type SchedulingConflictWindow = {
  professionalId: string
  startsAt: Date
  endsAt: Date
}

export type FindSchedulingConflictsArgs = SchedulingConflictWindow & {
  tx: PrismaTransactionClient
  excludeBookingId?: string | null
  excludeHoldId?: string | null
  now?: Date
}

type BookingConflictRow = {
  id: string
  professionalId: string
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
}

type HoldConflictRow = {
  id: string
  professionalId: string
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  bufferMinutesSnapshot: number | null
  endsAtSnapshot: Date | null
  expiresAt: Date
}

export type SchedulingConflictsResult = {
  bookings: SchedulingConflict[]
  holds: SchedulingConflict[]
  all: SchedulingConflict[]
}

export function calculateWindowEnd(args: {
  startsAt: Date
  durationMinutes: number | null
  bufferMinutes: number | null
  fallbackEndsAt?: Date | null
}): Date {
  if (args.fallbackEndsAt) {
    return args.fallbackEndsAt
  }

  // Mirror the durable SQL EXCLUDE constraint floor (GREATEST(1, dur+buf)) so a
  // null/zero snapshot yields a 1-minute window, never a 0-length one that the
  // database constraint would still treat as occupied. Keeps this runtime
  // builder from ever reserving LESS than the DB (which would let availability
  // clear a slot Postgres rejects with 23P01).
  return new Date(
    args.startsAt.getTime() +
      sqlBusyWindowMinutes(args.durationMinutes, args.bufferMinutes) * 60_000,
  )
}

export function windowsOverlap(
  left: {
    startsAt: Date
    endsAt: Date
  },
  right: {
    startsAt: Date
    endsAt: Date
  },
): boolean {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt
}

export function toBookingSchedulingConflict(
  row: BookingConflictRow,
): SchedulingConflict {
  // Bookings share the canonical busy-interval math with conflictQueries.ts
  // (`bookingToBusyInterval`: clamps duration to [15, MAX_SLOT] and buffer to
  // [0, MAX_BUFFER], floors the start to the minute). Delegating here keeps the
  // write-boundary conflict check and the availability/policy checks from ever
  // disagreeing on a booking's busy window. For in-range, minute-aligned data
  // this is identical to the previous calculateWindowEnd result.
  const { start, end } = bookingToBusyInterval({
    scheduledFor: row.scheduledFor,
    totalDurationMinutes: row.totalDurationMinutes,
    bufferMinutes: row.bufferMinutes,
  })

  return {
    kind: 'BOOKING',
    id: row.id,
    professionalId: row.professionalId,
    startsAt: start,
    endsAt: end,
  }
}

export function toHoldSchedulingConflict(row: HoldConflictRow): SchedulingConflict {
  return {
    kind: 'HOLD',
    id: row.id,
    professionalId: row.professionalId,
    startsAt: row.scheduledFor,
    endsAt: calculateWindowEnd({
      startsAt: row.scheduledFor,
      durationMinutes: row.durationMinutesSnapshot,
      bufferMinutes: row.bufferMinutesSnapshot,
      fallbackEndsAt: row.endsAtSnapshot,
    }),
  }
}

export async function findSchedulingConflicts({
  tx,
  professionalId,
  startsAt,
  endsAt,
  excludeBookingId = null,
  excludeHoldId = null,
  now = new Date(),
}: FindSchedulingConflictsArgs): Promise<SchedulingConflictsResult> {
  const bookingRows = await tx.booking.findMany({
    where: {
      professionalId,
      status: {
        in: [...BOOKING_BLOCKING_STATUSES],
      },
        scheduledFor: {
        gte: getConflictWindowStart(startsAt),
        lt: endsAt,
        },
      ...(excludeBookingId
        ? {
            id: {
              not: excludeBookingId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      professionalId: true,
      scheduledFor: true,
      totalDurationMinutes: true,
      bufferMinutes: true,
    },
  })

  const holdRows = await tx.bookingHold.findMany({
    where: {
      professionalId,
      expiresAt: {
        gt: now,
      },
      scheduledFor: {
        gte: getConflictWindowStart(startsAt),
        lt: endsAt,
      },
      ...(excludeHoldId
        ? {
            id: {
              not: excludeHoldId,
            },
          }
        : {}),
    },
    select: {
      id: true,
      professionalId: true,
      scheduledFor: true,
      durationMinutesSnapshot: true,
      bufferMinutesSnapshot: true,
      endsAtSnapshot: true,
      expiresAt: true,
    },
  })

  const requestedWindow = {
    startsAt,
    endsAt,
  }

  const bookings = bookingRows
    .map(toBookingSchedulingConflict)
    .filter((conflict) => windowsOverlap(requestedWindow, conflict))

  const holds = holdRows
    .map(toHoldSchedulingConflict)
    .filter((conflict) => windowsOverlap(requestedWindow, conflict))

  const all = [...bookings, ...holds].sort(
    (left, right) => left.startsAt.getTime() - right.startsAt.getTime(),
  )

  return {
    bookings,
    holds,
    all,
  }
}