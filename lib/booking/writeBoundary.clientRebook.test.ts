// lib/booking/writeBoundary.clientRebook.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingStatus,
} from '@prisma/client'

const FINISHED_AT = new Date('2026-04-12T18:00:00.000Z')
const AFTERCARE_SENT_AT = new Date('2026-04-12T18:05:00.000Z')
const PAYMENT_COLLECTED_AT = new Date('2026-04-12T18:10:00.000Z')
const REBOOKED_FOR = new Date('2030-05-01T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),

  txAftercareSummaryFindUnique: vi.fn(),
  txBookingFindFirst: vi.fn(),

  txProfessionalProfileUpdate: vi.fn(),
  txExecuteRaw: vi.fn(),
  txQueryRaw: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  areAuditValuesEqual: mocks.areAuditValuesEqual,
}))

import { createClientRebookedBookingFromAftercare } from './writeBoundary'

const tx = {
  aftercareSummary: {
    findUnique: mocks.txAftercareSummaryFindUnique,
  },
  booking: {
    findFirst: mocks.txBookingFindFirst,
  },
  professionalProfile: {
    update: mocks.txProfessionalProfileUpdate,
  },
  $executeRaw: mocks.txExecuteRaw,
  $queryRaw: mocks.txQueryRaw,
}

function makeAftercareRef(
  overrides?: Partial<{
    id: string
    bookingId: string
    booking: {
      id: string
      clientId: string
      professionalId: string
    } | null
  }>,
) {
  return {
    id: overrides?.id ?? 'aftercare_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    booking:
      overrides && 'booking' in overrides
        ? overrides.booking
        : {
            id: 'booking_1',
            clientId: 'client_1',
            professionalId: 'pro_1',
          },
  }
}

function makeSourceBooking(
  overrides?: Partial<{
    id: string
    clientId: string
    professionalId: string
    status: BookingStatus
    finishedAt: Date | null
    checkoutStatus: BookingCheckoutStatus
    paymentCollectedAt: Date | null
    aftercareSummary: { id: string; sentToClientAt: Date | null } | null
    locationId: string | null
  }>,
) {
  return {
    id: overrides?.id ?? 'booking_1',
    clientId: overrides?.clientId ?? 'client_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    status: overrides?.status ?? BookingStatus.COMPLETED,
    finishedAt:
      overrides && 'finishedAt' in overrides
        ? (overrides.finishedAt ?? null)
        : FINISHED_AT,
    checkoutStatus: overrides?.checkoutStatus ?? BookingCheckoutStatus.PAID,
    paymentCollectedAt:
      overrides && 'paymentCollectedAt' in overrides
        ? (overrides.paymentCollectedAt ?? null)
        : PAYMENT_COLLECTED_AT,
    aftercareSummary:
      overrides && 'aftercareSummary' in overrides
        ? overrides.aftercareSummary
        : {
            id: 'aftercare_1',
            sentToClientAt: AFTERCARE_SENT_AT,
          },
    locationId: overrides?.locationId ?? 'location_1',
  }
}

function makeExistingRebook() {
  return {
    id: 'booking_rebook_1',
    status: BookingStatus.PENDING,
    scheduledFor: REBOOKED_FOR,
  }
}

function makeExistingAftercare() {
  return {
    id: 'aftercare_1',
    rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
    rebookedFor: REBOOKED_FOR,
  }
}

function makeArgs() {
  return {
    aftercareId: 'aftercare_1',
    bookingId: 'booking_1',
    clientId: 'client_1',
    scheduledFor: REBOOKED_FOR,
    requestId: 'req_rebook_1',
    idempotencyKey: 'idem_rebook_1',
  }
}

function mockAftercareLockSequence() {
  const ref = makeAftercareRef()

  mocks.txAftercareSummaryFindUnique
    .mockResolvedValueOnce(ref)
    .mockResolvedValueOnce(ref)
}

describe('lib/booking/writeBoundary createClientRebookedBookingFromAftercare lifecycle guards', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.txProfessionalProfileUpdate.mockResolvedValue({
      id: 'pro_1',
    })

    mocks.txExecuteRaw.mockResolvedValue(1)
    mocks.txQueryRaw.mockResolvedValue([])
  })

  it('returns an existing rebook only when the source booking closeout is complete', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst
      .mockResolvedValueOnce(makeSourceBooking())
      .mockResolvedValueOnce(makeExistingRebook())

    mocks.txAftercareSummaryFindUnique.mockResolvedValueOnce(
      makeExistingAftercare(),
    )

    const result = await createClientRebookedBookingFromAftercare(makeArgs())

    expect(result).toEqual({
      booking: {
        id: 'booking_rebook_1',
        status: BookingStatus.PENDING,
        scheduledFor: REBOOKED_FOR,
      },
      aftercare: {
        id: 'aftercare_1',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: REBOOKED_FOR,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })

    expect(mocks.txBookingFindFirst).toHaveBeenCalledTimes(2)
    expect(mocks.createBookingCloseoutAuditLog).not.toHaveBeenCalled()
  })

  it('rejects when the aftercare link belongs to another client', async () => {
    const ref = makeAftercareRef({
      booking: {
        id: 'booking_1',
        clientId: 'client_other',
        professionalId: 'pro_1',
      },
    })

    mocks.txAftercareSummaryFindUnique.mockResolvedValueOnce(ref)

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txBookingFindFirst).not.toHaveBeenCalled()
  })

  it('rejects when the source booking belongs to another client', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        clientId: 'client_other',
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when the source booking is not completed', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        status: BookingStatus.ACCEPTED,
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })

  it('rejects when the source booking has no finishedAt timestamp', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        finishedAt: null,
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })

  it('rejects when source aftercare is missing', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        aftercareSummary: null,
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })

  it('rejects when source aftercare does not match the requested aftercare id', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        aftercareSummary: {
          id: 'aftercare_other',
          sentToClientAt: AFTERCARE_SENT_AT,
        },
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('rejects when source aftercare is still a draft', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        aftercareSummary: {
          id: 'aftercare_1',
          sentToClientAt: null,
        },
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })

  it('rejects when source checkout is not complete', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        checkoutStatus: BookingCheckoutStatus.READY,
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })

  it('rejects when source payment is not collected', async () => {
    mockAftercareLockSequence()

    mocks.txBookingFindFirst.mockResolvedValueOnce(
      makeSourceBooking({
        paymentCollectedAt: null,
      }),
    )

    await expect(
      createClientRebookedBookingFromAftercare(makeArgs()),
    ).rejects.toMatchObject({
      code: 'AFTERCARE_NOT_COMPLETED',
    })
  })
})