// lib/booking/writeBoundary.explicitStart.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, SessionStep } from '@prisma/client'

const TEST_NOW = new Date('2026-04-15T14:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),
  txBookingOverrideAuditLogCreate: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),

  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import { startBookingSession } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  bookingOverrideAuditLog: {
    create: mocks.txBookingOverrideAuditLogCreate,
  },
}

function makeAcceptedBooking(scheduledFor: Date) {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    scheduledFor,
    startedAt: null,
    finishedAt: null,
    sessionStep: SessionStep.NONE,
  }
}

describe('startBookingSession — explicit selection start window override', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: TEST_NOW }),
    )

    mocks.txBookingUpdate.mockImplementation(
      async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: 'booking_1',
        status: data.status ?? BookingStatus.IN_PROGRESS,
        startedAt: data.startedAt ?? TEST_NOW,
        finishedAt: null,
        sessionStep: data.sessionStep ?? SessionStep.CONSULTATION,
      }),
    )

    mocks.txBookingOverrideAuditLogCreate.mockResolvedValue({ id: 'audit_1' })
    mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
    mocks.upsertClientNotification.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('explicitSelection=true outside window → starts successfully and writes override audit log', async () => {
    const twoHoursFromNow = new Date(TEST_NOW.getTime() + 2 * 60 * 60 * 1000)
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAcceptedBooking(twoHoursFromNow),
    )

    const result = await startBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_1',
      idempotencyKey: 'idem_1',
      explicitSelection: true,
      actorUserId: 'user_1',
    })

    expect(result.booking.status).toBe(BookingStatus.IN_PROGRESS)
    expect(result.booking.sessionStep).toBe(SessionStep.CONSULTATION)
    expect(result.meta.mutated).toBe(true)

    expect(mocks.txBookingOverrideAuditLogCreate).toHaveBeenCalledOnce()
    expect(mocks.txBookingOverrideAuditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        action: 'START',
        rule: 'START_WINDOW',
        reason: null,
        route: 'lib/booking/writeBoundary.ts:startBookingSession',
        oldValue: expect.objectContaining({
          withinWindow: false,
          windowMinutes: 15,
        }),
        newValue: {
          withinWindow: true,
          explicitSelection: true,
        },
        metadata: {
          source: 'explicit_selection_start',
          trigger: 'pro_explicit_start',
        },
      }),
    })
  })

  it('explicitSelection=true inside window → starts successfully without override audit log', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAcceptedBooking(TEST_NOW),
    )

    const result = await startBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_2',
      idempotencyKey: 'idem_2',
      explicitSelection: true,
      actorUserId: 'user_1',
    })

    expect(result.booking.status).toBe(BookingStatus.IN_PROGRESS)
    expect(result.meta.mutated).toBe(true)

    expect(mocks.txBookingOverrideAuditLogCreate).not.toHaveBeenCalled()
  })

  it('explicitSelection=false outside window → throws FORBIDDEN', async () => {
    const twoHoursFromNow = new Date(TEST_NOW.getTime() + 2 * 60 * 60 * 1000)
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAcceptedBooking(twoHoursFromNow),
    )

    await expect(
      startBookingSession({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        requestId: 'req_3',
        idempotencyKey: 'idem_3',
        explicitSelection: false,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txBookingOverrideAuditLogCreate).not.toHaveBeenCalled()
  })

  it('explicitSelection omitted outside window → throws FORBIDDEN (default behavior)', async () => {
    const twoHoursFromNow = new Date(TEST_NOW.getTime() + 2 * 60 * 60 * 1000)
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAcceptedBooking(twoHoursFromNow),
    )

    await expect(
      startBookingSession({
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        requestId: 'req_4',
        idempotencyKey: 'idem_4',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
  })

  it('explicitSelection=false inside window → starts normally', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeAcceptedBooking(TEST_NOW),
    )

    const result = await startBookingSession({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      requestId: 'req_5',
      idempotencyKey: 'idem_5',
      explicitSelection: false,
    })

    expect(result.booking.status).toBe(BookingStatus.IN_PROGRESS)
    expect(result.meta.mutated).toBe(true)

    expect(mocks.txBookingOverrideAuditLogCreate).not.toHaveBeenCalled()
  })
})
