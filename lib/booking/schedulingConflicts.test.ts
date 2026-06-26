// lib/booking/schedulingConflicts.test.ts

import { BookingStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import {
  calculateWindowEnd,
  findSchedulingConflicts,
  toBookingSchedulingConflict,
  toHoldSchedulingConflict,
  windowsOverlap,
  type PrismaTransactionClient,
} from './schedulingConflicts'

type BookingFindManyArgs = {
  where: {
    professionalId: string
    status: {
      in: BookingStatus[]
    }
    scheduledFor: {
      gte: Date
      lt: Date
    }
    id?: {
      not: string
    }
  }
  select: {
    id: true
    professionalId: true
    scheduledFor: true
    totalDurationMinutes: true
    bufferMinutes: true
  }
}

type HoldFindManyArgs = {
  where: {
    professionalId: string
    expiresAt: {
      gt: Date
    }
    scheduledFor: {
      gte: Date
      lt: Date
    }
    id?: {
      not: string
    }
  }
  select: {
    id: true
    professionalId: true
    scheduledFor: true
    durationMinutesSnapshot: true
    bufferMinutesSnapshot: true
    endsAtSnapshot: true
    expiresAt: true
  }
}

type BookingRow = {
  id: string
  professionalId: string
  scheduledFor: Date
  totalDurationMinutes: number
  bufferMinutes: number
}

type HoldRow = {
  id: string
  professionalId: string
  scheduledFor: Date
  durationMinutesSnapshot: number | null
  bufferMinutesSnapshot: number | null
  endsAtSnapshot: Date | null
  expiresAt: Date
}

type MockTx = {
  booking: {
    findMany: ReturnType<typeof vi.fn<(args: BookingFindManyArgs) => Promise<BookingRow[]>>>
  }
  bookingHold: {
    findMany: ReturnType<typeof vi.fn<(args: HoldFindManyArgs) => Promise<HoldRow[]>>>
  }
}

function makeTx(args: {
  bookings?: BookingRow[]
  holds?: HoldRow[]
}): MockTx {
  return {
    booking: {
      findMany: vi.fn((query: BookingFindManyArgs) => {
        return Promise.resolve(args.bookings ?? [])
      }),
    },
    bookingHold: {
      findMany: vi.fn((query: HoldFindManyArgs) => {
        return Promise.resolve(args.holds ?? [])
      }),
    },
  }
}

function asTransactionClient(tx: MockTx): PrismaTransactionClient {
  return tx as unknown as PrismaTransactionClient
}

const requestedStart = new Date('2026-06-01T17:00:00.000Z')
const requestedEnd = new Date('2026-06-01T18:00:00.000Z')
const now = new Date('2026-06-01T16:00:00.000Z')

describe('calculateWindowEnd', () => {
  it('adds duration and buffer minutes', () => {
    expect(
      calculateWindowEnd({
        startsAt: requestedStart,
        durationMinutes: 45,
        bufferMinutes: 15,
      }).toISOString(),
    ).toBe('2026-06-01T18:00:00.000Z')
  })

  it('uses fallback end when provided', () => {
    const fallbackEndsAt = new Date('2026-06-01T18:30:00.000Z')

    expect(
      calculateWindowEnd({
        startsAt: requestedStart,
        durationMinutes: 45,
        bufferMinutes: 15,
        fallbackEndsAt,
      }),
    ).toBe(fallbackEndsAt)
  })

  it('floors null duration and buffer to the SQL 1-minute minimum', () => {
    // Matches the DB constraint floor GREATEST(1, COALESCE(dur,0)+COALESCE(buf,0))
    // so the runtime window is never shorter (0-length) than the database treats
    // the row as occupied.
    expect(
      calculateWindowEnd({
        startsAt: requestedStart,
        durationMinutes: null,
        bufferMinutes: null,
      }).toISOString(),
    ).toBe('2026-06-01T17:01:00.000Z')
  })

  it('floors negative duration and buffer to the SQL 1-minute minimum', () => {
    expect(
      calculateWindowEnd({
        startsAt: requestedStart,
        durationMinutes: -20,
        bufferMinutes: -5,
      }).toISOString(),
    ).toBe('2026-06-01T17:01:00.000Z')
  })
})

describe('windowsOverlap', () => {
  it('returns true for partially overlapping windows', () => {
    expect(
      windowsOverlap(
        {
          startsAt: new Date('2026-06-01T17:00:00.000Z'),
          endsAt: new Date('2026-06-01T18:00:00.000Z'),
        },
        {
          startsAt: new Date('2026-06-01T17:30:00.000Z'),
          endsAt: new Date('2026-06-01T18:30:00.000Z'),
        },
      ),
    ).toBe(true)
  })

  it('returns false when one window ends exactly as the other starts', () => {
    expect(
      windowsOverlap(
        {
          startsAt: new Date('2026-06-01T17:00:00.000Z'),
          endsAt: new Date('2026-06-01T18:00:00.000Z'),
        },
        {
          startsAt: new Date('2026-06-01T18:00:00.000Z'),
          endsAt: new Date('2026-06-01T19:00:00.000Z'),
        },
      ),
    ).toBe(false)
  })
})

describe('row mappers', () => {
  it('maps a booking row into a scheduling conflict', () => {
    const conflict = toBookingSchedulingConflict({
      id: 'booking_1',
      professionalId: 'pro_1',
      scheduledFor: requestedStart,
      totalDurationMinutes: 50,
      bufferMinutes: 10,
    })

    expect(conflict).toEqual({
      kind: 'BOOKING',
      id: 'booking_1',
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
    })
  })

  it('maps a hold row into a scheduling conflict using endsAtSnapshot when present', () => {
    const endsAtSnapshot = new Date('2026-06-01T18:30:00.000Z')

    const conflict = toHoldSchedulingConflict({
      id: 'hold_1',
      professionalId: 'pro_1',
      scheduledFor: requestedStart,
      durationMinutesSnapshot: 50,
      bufferMinutesSnapshot: 10,
      endsAtSnapshot,
      expiresAt: new Date('2026-06-01T16:30:00.000Z'),
    })

    expect(conflict).toEqual({
      kind: 'HOLD',
      id: 'hold_1',
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: endsAtSnapshot,
    })
  })

  it('maps a hold row into a scheduling conflict using duration snapshots when no end snapshot exists', () => {
    const conflict = toHoldSchedulingConflict({
      id: 'hold_1',
      professionalId: 'pro_1',
      scheduledFor: requestedStart,
      durationMinutesSnapshot: 50,
      bufferMinutesSnapshot: 10,
      endsAtSnapshot: null,
      expiresAt: new Date('2026-06-01T16:30:00.000Z'),
    })

    expect(conflict.endsAt).toEqual(requestedEnd)
  })
})

describe('findSchedulingConflicts', () => {
  it('queries active bookings and unexpired holds for the same pro before the requested end', async () => {
    const tx = makeTx({})

    await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      now,
    })

    const bookingCall = tx.booking.findMany.mock.calls[0]?.[0]
    const holdCall = tx.bookingHold.findMany.mock.calls[0]?.[0]

    expect(bookingCall?.where).toEqual({
      professionalId: 'pro_1',
      status: {
        in: [
          BookingStatus.PENDING,
          BookingStatus.ACCEPTED,
          BookingStatus.IN_PROGRESS,
          BookingStatus.COMPLETED,
        ],
      },
      scheduledFor: {
        gte: new Date('2026-06-01T02:00:00.000Z'),
        lt: requestedEnd,
      },
    })

    expect(holdCall?.where).toEqual({
      professionalId: 'pro_1',
      expiresAt: {
        gt: now,
      },
      scheduledFor: {
        gte: new Date('2026-06-01T02:00:00.000Z'),
        lt: requestedEnd,
      },
    })
  })

  it('includes overlapping booking conflicts', async () => {
    const tx = makeTx({
      bookings: [
        {
          id: 'booking_1',
          professionalId: 'pro_1',
          scheduledFor: new Date('2026-06-01T17:30:00.000Z'),
          totalDurationMinutes: 60,
          bufferMinutes: 0,
        },
      ],
    })

    const result = await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      now,
    })

    expect(result.bookings).toHaveLength(1)
    expect(result.bookings[0]?.id).toBe('booking_1')
    expect(result.holds).toHaveLength(0)
    expect(result.all.map((conflict) => conflict.id)).toEqual(['booking_1'])
  })

  it('treats completed bookings as scheduling conflicts to match availability occupancy rules', async () => {
    const tx = makeTx({
      bookings: [
        {
          id: 'booking_completed_1',
          professionalId: 'pro_1',
          scheduledFor: new Date('2026-06-01T17:30:00.000Z'),
          totalDurationMinutes: 30,
          bufferMinutes: 0,
        },
      ],
    })

    const result = await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      now,
    })

    expect(tx.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              BookingStatus.PENDING,
              BookingStatus.ACCEPTED,
              BookingStatus.IN_PROGRESS,
              BookingStatus.COMPLETED,
            ],
          },
        }),
      }),
    )

    expect(result.bookings).toEqual([
      {
        kind: 'BOOKING',
        id: 'booking_completed_1',
        professionalId: 'pro_1',
        startsAt: new Date('2026-06-01T17:30:00.000Z'),
        endsAt: new Date('2026-06-01T18:00:00.000Z'),
      },
    ])
  })

  it('includes overlapping hold conflicts', async () => {
    const tx = makeTx({
      holds: [
        {
          id: 'hold_1',
          professionalId: 'pro_1',
          scheduledFor: new Date('2026-06-01T17:30:00.000Z'),
          durationMinutesSnapshot: 60,
          bufferMinutesSnapshot: 0,
          endsAtSnapshot: null,
          expiresAt: new Date('2026-06-01T16:30:00.000Z'),
        },
      ],
    })

    const result = await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      now,
    })

    expect(result.bookings).toHaveLength(0)
    expect(result.holds).toHaveLength(1)
    expect(result.all.map((conflict) => conflict.id)).toEqual(['hold_1'])
  })

  it('filters out rows that end exactly at requested start', async () => {
    const tx = makeTx({
      bookings: [
        {
          id: 'booking_before',
          professionalId: 'pro_1',
          scheduledFor: new Date('2026-06-01T16:00:00.000Z'),
          totalDurationMinutes: 60,
          bufferMinutes: 0,
        },
      ],
    })

    const result = await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      now,
    })

    expect(result.all).toEqual([])
  })

  it('adds exclude filters when provided', async () => {
    const tx = makeTx({})

    await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      excludeBookingId: 'booking_current',
      excludeHoldId: 'hold_current',
      now,
    })

    const bookingCall = tx.booking.findMany.mock.calls[0]?.[0]
    const holdCall = tx.bookingHold.findMany.mock.calls[0]?.[0]

    expect(bookingCall?.where.id).toEqual({
      not: 'booking_current',
    })

    expect(holdCall?.where.id).toEqual({
      not: 'hold_current',
    })
  })

  it('returns all conflicts sorted by start time', async () => {
    const tx = makeTx({
      bookings: [
        {
          id: 'booking_late',
          professionalId: 'pro_1',
          scheduledFor: new Date('2026-06-01T17:45:00.000Z'),
          totalDurationMinutes: 30,
          bufferMinutes: 0,
        },
      ],
      holds: [
        {
          id: 'hold_early',
          professionalId: 'pro_1',
          scheduledFor: new Date('2026-06-01T17:15:00.000Z'),
          durationMinutesSnapshot: 30,
          bufferMinutesSnapshot: 0,
          endsAtSnapshot: null,
          expiresAt: new Date('2026-06-01T16:30:00.000Z'),
        },
      ],
    })

    const result = await findSchedulingConflicts({
      tx: asTransactionClient(tx),
      professionalId: 'pro_1',
      startsAt: requestedStart,
      endsAt: requestedEnd,
      now,
    })

    expect(result.all.map((conflict) => conflict.id)).toEqual([
      'hold_early',
      'booking_late',
    ])
  })
})