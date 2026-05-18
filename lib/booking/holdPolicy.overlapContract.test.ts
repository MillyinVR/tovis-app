// lib/booking/holdPolicy.overlapContract.test.ts

import { describe, expect, it } from 'vitest'
import { Prisma, ServiceLocationType } from '@prisma/client'
import { evaluateHoldCreationDecision } from './policies/holdPolicy'
import type { WorkingHoursObj } from '@/lib/scheduling/workingHoursValidation'

type TxOverrides = {
  blockedTimes?: unknown[]
  bookings?: unknown[]
  holds?: unknown[]
}

function makeTx(overrides?: {
  blockedTimes?: unknown[]
  bookings?: unknown[]
  holds?: unknown[]
}): Prisma.TransactionClient {
  const blockedTimeConflict = overrides?.blockedTimes?.[0] ?? null
  const bookingConflict = overrides?.bookings?.[0] ?? null
  const holdConflict = overrides?.holds?.[0] ?? null

  return {
    calendarBlock: {
      findFirst: async () => blockedTimeConflict,
      findMany: async () => overrides?.blockedTimes ?? [],
    },
    calendarBlockedTime: {
      findFirst: async () => blockedTimeConflict,
      findMany: async () => overrides?.blockedTimes ?? [],
    },
    booking: {
      findFirst: async () => bookingConflict,
      findMany: async () => overrides?.bookings ?? [],
    },
    bookingHold: {
      findFirst: async () => holdConflict,
      findMany: async () => overrides?.holds ?? [],
    },
  } as unknown as Prisma.TransactionClient
}

function makeWorkingHours(): WorkingHoursObj {
  return {
    sun: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
    mon: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
    tue: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
    wed: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
    thu: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
    fri: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
    sat: {
      enabled: true,
      start: '09:00',
      end: '17:00',
    },
  }
}

function makeArgs(
  overrides?: Partial<Parameters<typeof evaluateHoldCreationDecision>[0]>,
): Parameters<typeof evaluateHoldCreationDecision>[0] {
  return {
    tx: makeTx(),
    now: new Date('2030-05-01T16:00:00.000Z'),
    professionalId: 'pro_1',
    locationId: 'location_1',
    locationType: ServiceLocationType.SALON,
    offeringId: 'offering_1',
    clientId: 'client_1',
    clientAddressId: null,
    requestedStart: new Date('2030-05-01T18:00:00.000Z'),
    durationMinutes: 60,
    bufferMinutes: 15,
    workingHours: makeWorkingHours(),
    timeZone: 'America/Los_Angeles',
    stepMinutes: 15,
    advanceNoticeMinutes: 0,
    maxDaysAhead: 3650,
    salonLocationAddress: '123 Salon St, Los Angeles, CA',
    clientServiceAddress: null,
    ...overrides,
  }
}

describe('evaluateHoldCreationDecision overlap contract', () => {
  it('allows hold creation when the requested window has no overlap conflicts', async () => {
    await expect(
    evaluateHoldCreationDecision(makeArgs()),
    ).resolves.toMatchObject({
    ok: true,
    value: {
        requestedEnd: new Date('2030-05-01T19:15:00.000Z'),
    },
    })
  })

  it('blocks hold creation when the requested window overlaps an existing booking', async () => {
    await expect(
      evaluateHoldCreationDecision(
        makeArgs({
          tx: makeTx({
            bookings: [
              {
                id: 'booking_1',
                scheduledFor: new Date('2030-05-01T18:30:00.000Z'),
                totalDurationMinutes: 60,
                bufferMinutes: 0,
              },
            ],
          }),
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'TIME_BOOKED',
      logHint: {
        conflictType: 'BOOKING',
      },
    })
  })

  it('blocks hold creation when the requested window overlaps an existing active hold', async () => {
    await expect(
      evaluateHoldCreationDecision(
        makeArgs({
          tx: makeTx({
            holds: [
              {
                id: 'hold_1',
                scheduledFor: new Date('2030-05-01T18:30:00.000Z'),
                durationMinutesSnapshot: 60,
                bufferMinutesSnapshot: 0,
                expiresAt: new Date('2030-05-01T18:00:00.000Z'),
              },
            ],
          }),
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'TIME_HELD',
      logHint: {
        conflictType: 'HOLD',
      },
    })
  })

  it('blocks hold creation when the requested window overlaps blocked time', async () => {
    await expect(
      evaluateHoldCreationDecision(
        makeArgs({
          tx: makeTx({
            blockedTimes: [
              {
                id: 'blocked_1',
                startsAt: new Date('2030-05-01T18:30:00.000Z'),
                endsAt: new Date('2030-05-01T19:00:00.000Z'),
              },
            ],
          }),
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'TIME_BLOCKED',
      logHint: {
        conflictType: 'BLOCKED',
      },
    })
  })
})