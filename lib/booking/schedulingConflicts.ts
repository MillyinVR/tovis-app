// lib/booking/schedulingConflicts.ts

import { type Prisma } from '@prisma/client'

import type { SchedulingConflict } from './overlapPolicy'
import { getConflictWindowStart } from '@/lib/booking/conflicts'
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

  const durationMinutes =
    typeof args.durationMinutes === 'number' &&
    Number.isFinite(args.durationMinutes) &&
    args.durationMinutes > 0
      ? args.durationMinutes
      : 0

  const bufferMinutes =
    typeof args.bufferMinutes === 'number' &&
    Number.isFinite(args.bufferMinutes) &&
    args.bufferMinutes > 0
      ? args.bufferMinutes
      : 0

  return new Date(
    args.startsAt.getTime() + (durationMinutes + bufferMinutes) * 60_000,
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
  return {
    kind: 'BOOKING',
    id: row.id,
    professionalId: row.professionalId,
    startsAt: row.scheduledFor,
    endsAt: calculateWindowEnd({
      startsAt: row.scheduledFor,
      durationMinutes: row.totalDurationMinutes,
      bufferMinutes: row.bufferMinutes,
    }),
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