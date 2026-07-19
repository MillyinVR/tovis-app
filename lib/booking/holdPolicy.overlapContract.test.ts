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

// The slot-readiness refusals below used to be spelled out inside holdPolicy.
// They now come from the SHARED mapSlotReadinessToBookingError, which last-minute
// opening creation also calls so a pro cannot publish an opening no client can
// hold. These are characterization tests: they pin the code, the user-facing copy
// AND the working-hours log breadcrumb exactly as the hold reported them before
// the extraction, so a change to the shared mapping can't silently reword or
// re-code a refusal a client already sees.
describe('evaluateHoldCreationDecision slot-readiness refusals', () => {
  it('refuses an off-step start and names the boundary', async () => {
    await expect(
      evaluateHoldCreationDecision(
        makeArgs({ requestedStart: new Date('2030-05-01T18:07:00.000Z') }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'STEP_MISMATCH',
      message: 'Start time must be on a 15-minute boundary.',
      userMessage: 'Start time must be on a 15-minute boundary.',
      logHint: { conflictType: 'STEP_BOUNDARY' },
    })
  })

  it('refuses a start outside working hours with human copy, not the guard sentinel', async () => {
    // 20:00 PT, on the 15-minute grid — the salon closed at 17:00.
    const decision = await evaluateHoldCreationDecision(
      makeArgs({ requestedStart: new Date('2030-05-02T03:00:00.000Z') }),
    )

    expect(decision).toMatchObject({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      userMessage: 'That time is outside working hours.',
      logHint: { conflictType: 'WORKING_HOURS' },
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      // The sentinel stays in the LOG breadcrumb and never reaches the user.
      expect(decision.logHint?.meta?.workingHoursError).toBe(
        'BOOKING_WORKING_HOURS:OUTSIDE_WORKING_HOURS',
      )
      expect(decision.userMessage).not.toContain('BOOKING_WORKING_HOURS:')
    }
  })

  it('refuses a start with no working hours configured for the location', async () => {
    const decision = await evaluateHoldCreationDecision(
      makeArgs({ workingHours: null }),
    )

    expect(decision).toMatchObject({
      ok: false,
      code: 'WORKING_HOURS_REQUIRED',
      logHint: { conflictType: 'WORKING_HOURS' },
    })
    if (!decision.ok) {
      expect(decision.logHint?.meta?.workingHoursError).toBe(
        'BOOKING_WORKING_HOURS:WORKING_HOURS_REQUIRED',
      )
    }
  })

  it('refuses a start inside the advance-notice window', async () => {
    await expect(
      evaluateHoldCreationDecision(makeArgs({ advanceNoticeMinutes: 24 * 60 })),
    ).resolves.toMatchObject({
      ok: false,
      code: 'ADVANCE_NOTICE_REQUIRED',
    })
  })

  it('refuses a start beyond the max-days-ahead horizon', async () => {
    await expect(
      // 10:00 PT four days out — on-step and inside working hours, so the ONLY
      // thing that can refuse it is the horizon.
      evaluateHoldCreationDecision(
        makeArgs({
          maxDaysAhead: 1,
          requestedStart: new Date('2030-05-05T17:00:00.000Z'),
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: 'MAX_DAYS_AHEAD_EXCEEDED',
    })
  })
})