// lib/booking/writeBoundary.aftercareRebookSlot.test.ts

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingStatus,
  ContactMethod,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

import { upsertBookingAftercare } from '@/lib/booking/writeBoundary'
import { prisma } from '@/lib/prisma'
import { validateAftercareRebookSlotOwnership } from '@/lib/booking/aftercareRebookSlotOwnership'
import { createAftercareAccessDelivery } from '@/lib/clientActions/createAftercareAccessDelivery'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: vi.fn(),
}))

vi.mock('@/lib/booking/aftercareRebookSlotOwnership', () => ({
  validateAftercareRebookSlotOwnership: vi.fn(),
}))

vi.mock('@/lib/clientActions/createAftercareAccessDelivery', () => ({
  createAftercareAccessDelivery: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  cancelBookingAppointmentReminders: vi.fn(),
  syncBookingAppointmentReminders: vi.fn(),
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: vi.fn(),
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleConfigVersion: vi.fn(),
  bumpScheduleVersion: vi.fn(),
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  areAuditValuesEqual: vi.fn(() => false),
  createBookingCloseoutAuditLog: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({}))

const mockedPrisma = prisma as unknown as {
  $transaction: Mock
}

const mockedValidateAftercareRebookSlotOwnership =
  validateAftercareRebookSlotOwnership as Mock

const mockedCreateAftercareAccessDelivery =
  createAftercareAccessDelivery as Mock

const mockedUpsertClientNotification = upsertClientNotification as Mock
type MockTx = {
  booking: {
    findUnique: Mock
    findFirst: Mock
    update: Mock
  }
  aftercareSummary: {
    upsert: Mock
    update: Mock
  }
  aftercareRebookSlot: {
    upsert: Mock
    deleteMany: Mock
  }
  clientAddress: {
    findFirst: Mock
  }
  product: {
    findMany: Mock
  }
  productRecommendation: {
    deleteMany: Mock
    createMany: Mock
  }
  reminder: {
    upsert: Mock
    deleteMany: Mock
  }
  mediaAsset: {
    count: Mock
  }
}

const bookingId = 'booking_1'
const professionalId = 'pro_1'
const actorUserId = 'user_1'
const clientId = 'client_1'
const aftercareId = 'aftercare_1'
const offeringId = 'offering_1'
const locationId = 'location_1'

const now = new Date('2026-05-17T18:00:00.000Z')
const rebookedFor = new Date('2026-06-01T17:00:00.000Z')
const rebookEndsAt = new Date('2026-06-01T18:00:00.000Z')

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: bookingId,
    clientId,
    professionalId,
    status: BookingStatus.IN_PROGRESS,
    sessionStep: SessionStep.AFTER_PHOTOS,
    scheduledFor: new Date('2026-05-01T17:00:00.000Z'),
    finishedAt: null,
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    paymentCollectedAt: null,
    locationTimeZone: 'America/Los_Angeles',
    clientTimeZoneAtBooking: 'America/Los_Angeles',
    service: {
      name: 'Haircut',
    },
    client: {
      id: clientId,
      userId: 'client_user_1',
      email: 'client@example.com',
      phone: null,
      preferredContactMethod: ContactMethod.EMAIL,
      firstName: 'Client',
      lastName: 'Person',
      user: {
        email: 'client-user@example.com',
        phone: null,
      },
    },
    aftercareSummary: {
      id: aftercareId,
      notes: 'Existing notes',
      rebookMode: AftercareRebookMode.NONE,
      rebookedFor: null,
      rebookWindowStart: null,
      rebookWindowEnd: null,
      draftSavedAt: now,
      sentToClientAt: null,
      lastEditedAt: now,
      version: 1,
      rebookSlot: null,
      rebookedBookingId: null,
      rebookedBooking: null,
      recommendedProducts: [],
    },
    professional: {
      timeZone: 'America/Los_Angeles',
    },
    ...overrides,
  }
}

// A booking whose summary already links a live next appointment that exactly
// mirrors the incoming slot — the booked-at-save sync then has nothing to do,
// which keeps slot-focused tests isolated from the create/cancel machinery.
function makeBookingWithMirroredRebook(args: {
  locationType: ServiceLocationType
  clientAddressId: string | null
}) {
  const base = makeBooking()
  return {
    ...base,
    aftercareSummary: {
      ...base.aftercareSummary,
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor,
      rebookedBookingId: 'rebooked_1',
      rebookedBooking: {
        id: 'rebooked_1',
        status: BookingStatus.ACCEPTED,
        scheduledFor: rebookedFor,
        locationType: args.locationType,
        clientAddressId: args.clientAddressId,
      },
    },
  }
}

function makeTx(overrides: Partial<MockTx> = {}): MockTx {
  const tx: MockTx = {
    booking: {
      findUnique: vi.fn().mockResolvedValue(makeBooking()),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    aftercareSummary: {
      upsert: vi.fn().mockResolvedValue({
        id: aftercareId,
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        draftSavedAt: now,
        sentToClientAt: null,
        lastEditedAt: now,
        version: 2,
      }),
      update: vi.fn(),
    },
    aftercareRebookSlot: {
      upsert: vi.fn().mockResolvedValue({
        id: 'slot_1',
      }),
      deleteMany: vi.fn().mockResolvedValue({
        count: 1,
      }),
    },
    clientAddress: {
      findFirst: vi.fn().mockResolvedValue({ id: 'address_1' }),
    },
    product: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    productRecommendation: {
      deleteMany: vi.fn().mockResolvedValue({
        count: 0,
      }),
      createMany: vi.fn().mockResolvedValue({
        count: 0,
      }),
    },
    reminder: {
      upsert: vi.fn().mockResolvedValue({ id: 'reminder_1' }),
      deleteMany: vi.fn().mockResolvedValue({
        count: 0,
      }),
    },
    mediaAsset: {
      count: vi.fn().mockResolvedValue(0),
    },
    ...overrides,
  }

  return tx
}

function mockTransaction(tx: MockTx) {
  mockedPrisma.$transaction.mockImplementation(async (callback: unknown) => {
    if (typeof callback !== 'function') {
      throw new Error('Expected prisma.$transaction callback.')
    }

    return callback(tx)
  })
}

function makeValidArgs(
  overrides: Partial<Parameters<typeof upsertBookingAftercare>[0]> = {},
): Parameters<typeof upsertBookingAftercare>[0] {
  return {
    bookingId,
    professionalId,
    actorUserId,
    notes: 'Aftercare notes',
    rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
    rebookedFor,
    rebookWindowStart: null,
    rebookWindowEnd: null,
    rebookSlot: {
      offeringId,
      locationId,
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
      startsAt: rebookedFor,
      endsAt: rebookEndsAt,
    },
    createRebookReminder: false,
    rebookReminderDaysBefore: 7,
    createProductReminder: false,
    productReminderDaysAfter: 14,
    recommendedProducts: [],
    sendToClient: false,
    version: 1,
    requestId: 'req_1',
    idempotencyKey: 'idem_1',
    ...overrides,
  }
}

async function expectBookingErrorCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code,
  })
}

describe('upsertBookingAftercare rebook slot handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockedValidateAftercareRebookSlotOwnership.mockResolvedValue({
      ok: true,
    })

    mockedCreateAftercareAccessDelivery.mockResolvedValue({
      link: {
        href: '/client/bookings/booking_1/aftercare',
      },
    } as Awaited<ReturnType<typeof createAftercareAccessDelivery>>)

    mockedUpsertClientNotification.mockResolvedValue(undefined)
  })

  it('requires a rebookSlot when rebookMode is BOOKED_NEXT_APPOINTMENT', async () => {
    const tx = makeTx()
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookSlot: null,
        }),
      ),
      'FORBIDDEN',
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
    expect(tx.aftercareRebookSlot.deleteMany).not.toHaveBeenCalled()
  })

  it('requires rebookSlot.offeringId when rebookMode is BOOKED_NEXT_APPOINTMENT', async () => {
    const tx = makeTx()
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookSlot: {
            offeringId: null,
            locationId,
            locationType: ServiceLocationType.SALON,
            clientAddressId: null,
            startsAt: rebookedFor,
            endsAt: rebookEndsAt,
          },
        }),
      ),
      'OFFERING_ID_REQUIRED',
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
    expect(tx.aftercareRebookSlot.deleteMany).not.toHaveBeenCalled()
  })

  it('rejects a rebookSlot when rebookMode is not BOOKED_NEXT_APPOINTMENT', async () => {
    const tx = makeTx()
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookSlot: {
            offeringId,
            locationId,
            locationType: ServiceLocationType.SALON,
            clientAddressId: null,
            startsAt: rebookedFor,
            endsAt: rebookEndsAt,
          },
        }),
      ),
      'FORBIDDEN',
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
    expect(tx.aftercareRebookSlot.deleteMany).not.toHaveBeenCalled()
  })

  it('requires rebookSlot.startsAt to match rebookedFor', async () => {
    const tx = makeTx()
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookedFor,
          rebookSlot: {
            offeringId,
            locationId,
            locationType: ServiceLocationType.SALON,
            clientAddressId: null,
            startsAt: new Date('2026-06-01T17:15:00.000Z'),
            endsAt: rebookEndsAt,
          },
        }),
      ),
      'FORBIDDEN',
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
  })

  it('requires rebookSlot.endsAt to be after startsAt', async () => {
    const tx = makeTx()
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookSlot: {
            offeringId,
            locationId,
            locationType: ServiceLocationType.SALON,
            clientAddressId: null,
            startsAt: rebookedFor,
            endsAt: rebookedFor,
          },
        }),
      ),
      'FORBIDDEN',
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
  })

  it('validates slot ownership and upserts the aftercare rebook slot', async () => {
    const tx = makeTx()
    tx.booking.findUnique.mockResolvedValue(
      makeBookingWithMirroredRebook({
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
      }),
    )
    mockTransaction(tx)

    await upsertBookingAftercare(makeValidArgs())

    expect(mockedValidateAftercareRebookSlotOwnership).toHaveBeenCalledWith({
      db: tx,
      slot: {
        professionalId,
        offeringId,
        locationId,
        locationType: ServiceLocationType.SALON,
      },
    })

    expect(tx.aftercareRebookSlot.upsert).toHaveBeenCalledWith({
      where: {
        aftercareSummaryId: aftercareId,
      },
      create: {
        aftercareSummaryId: aftercareId,
        professionalId,
        offeringId,
        locationId,
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        startsAt: rebookedFor,
        endsAt: rebookEndsAt,
      },
      update: {
        professionalId,
        offeringId,
        locationId,
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
        startsAt: rebookedFor,
        endsAt: rebookEndsAt,
      },
    })

    expect(tx.aftercareRebookSlot.deleteMany).not.toHaveBeenCalled()
  })

  it('persists the pro-picked client address on a MOBILE rebook slot', async () => {
    const tx = makeTx()
    tx.booking.findUnique.mockResolvedValue(
      makeBookingWithMirroredRebook({
        locationType: ServiceLocationType.MOBILE,
        clientAddressId: 'address_1',
      }),
    )
    mockTransaction(tx)

    await upsertBookingAftercare(
      makeValidArgs({
        rebookSlot: {
          offeringId,
          locationId,
          locationType: ServiceLocationType.MOBILE,
          clientAddressId: 'address_1',
          startsAt: rebookedFor,
          endsAt: rebookEndsAt,
        },
      }),
    )

    // Ownership: the address must be the booking client's SERVICE_ADDRESS.
    expect(tx.clientAddress.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'address_1',
        clientId,
        kind: 'SERVICE_ADDRESS',
      },
      select: { id: true },
    })

    expect(tx.aftercareRebookSlot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ clientAddressId: 'address_1' }),
        update: expect.objectContaining({ clientAddressId: 'address_1' }),
      }),
    )
  })

  it('rejects a MOBILE rebook slot address the client does not own', async () => {
    const tx = makeTx()
    tx.clientAddress.findFirst.mockResolvedValue(null)
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookSlot: {
            offeringId,
            locationId,
            locationType: ServiceLocationType.MOBILE,
            clientAddressId: 'address_not_owned',
            startsAt: rebookedFor,
            endsAt: rebookEndsAt,
          },
        }),
      ),
      'CLIENT_SERVICE_ADDRESS_INVALID',
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
  })

  it('never persists an address on a SALON rebook slot', async () => {
    const tx = makeTx()
    tx.booking.findUnique.mockResolvedValue(
      makeBookingWithMirroredRebook({
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
      }),
    )
    mockTransaction(tx)

    await upsertBookingAftercare(
      makeValidArgs({
        rebookSlot: {
          offeringId,
          locationId,
          locationType: ServiceLocationType.SALON,
          clientAddressId: 'address_1',
          startsAt: rebookedFor,
          endsAt: rebookEndsAt,
        },
      }),
    )

    // Salon visits happen at the pro's location: no ownership lookup, and the
    // stored slot's address is forced null.
    expect(tx.clientAddress.findFirst).not.toHaveBeenCalled()
    expect(tx.aftercareRebookSlot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ clientAddressId: null }),
        update: expect.objectContaining({ clientAddressId: null }),
      }),
    )
  })

  it('books the slot immediately when no next appointment is linked yet', async () => {
    // Wiring-level proof: with a BOOKED slot and no linked booking, the save
    // enters the rebook-create path (whose first read is the rebook source
    // select). The source read is stubbed to null so the attempt fails fast —
    // asserting on the rejection pins that the path fired at save time.
    const tx = makeTx()
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(makeValidArgs()),
      'BOOKING_NOT_FOUND',
    )

    expect(tx.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: bookingId, professionalId },
      }),
    )
    // The slot itself was persisted before the booking sync ran.
    expect(tx.aftercareRebookSlot.upsert).toHaveBeenCalled()
  })

  it('withdrawing the booked plan routes through the pro cancel path', async () => {
    // Wiring-level proof: switching the mode away from BOOKED with a live
    // linked booking must cancel that booking. The cancel path's booking load
    // is stubbed to null so it fails fast; the rejection + the read for the
    // linked id pin the wiring.
    const tx = makeTx()
    const mirrored = makeBookingWithMirroredRebook({
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
    })
    // The withdraw branch only releases an appointment that is still in the
    // future — pin the linked booking far ahead of the real clock.
    const linked = {
      ...mirrored,
      aftercareSummary: {
        ...mirrored.aftercareSummary,
        rebookedBooking: {
          ...mirrored.aftercareSummary.rebookedBooking,
          scheduledFor: new Date('2100-01-01T17:00:00.000Z'),
        },
      },
    }
    tx.booking.findUnique.mockImplementation(
      (query: { where?: { id?: string } }) =>
        Promise.resolve(query?.where?.id === bookingId ? linked : null),
    )
    mockTransaction(tx)

    await expectBookingErrorCode(
      upsertBookingAftercare(
        makeValidArgs({
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookSlot: null,
          notes: 'Changed my mind',
        }),
      ),
      'BOOKING_NOT_FOUND',
    )

    const findUniqueIds = tx.booking.findUnique.mock.calls.map(
      (call) => (call[0] as { where?: { id?: string } })?.where?.id,
    )
    expect(findUniqueIds).toContain('rebooked_1')
  })

  it('maps slot ownership validation failures to booking errors', async () => {
    const tx = makeTx()
    mockTransaction(tx)

    mockedValidateAftercareRebookSlotOwnership.mockResolvedValue({
      ok: false,
      code: 'LOCATION_NOT_BOOKABLE',
      userMessage: 'This location cannot be booked.',
    })

    await expectBookingErrorCode(upsertBookingAftercare(makeValidArgs()), 'BAD_LOCATION')

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
  })

  it('deletes the existing rebook slot when rebookMode is no longer BOOKED_NEXT_APPOINTMENT', async () => {
    const tx = makeTx({
      booking: {
        findUnique: vi.fn().mockResolvedValue(
          makeBooking({
            aftercareSummary: {
              id: aftercareId,
              notes: 'Existing notes',
              rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
              rebookedFor,
              rebookWindowStart: null,
              rebookWindowEnd: null,
              draftSavedAt: now,
              sentToClientAt: null,
              lastEditedAt: now,
              version: 1,
              rebookSlot: {
                offeringId,
                locationId,
                locationType: ServiceLocationType.SALON,
                startsAt: rebookedFor,
                endsAt: rebookEndsAt,
              },
              rebookedBookingId: null,
              rebookedBooking: null,
              recommendedProducts: [],
            },
          }),
        ),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      aftercareSummary: {
        upsert: vi.fn().mockResolvedValue({
          id: aftercareId,
          rebookMode: AftercareRebookMode.NONE,
          rebookedFor: null,
          rebookWindowStart: null,
          rebookWindowEnd: null,
          draftSavedAt: now,
          sentToClientAt: null,
          lastEditedAt: now,
          version: 2,
        }),
        update: vi.fn(),
      },
    })

    mockTransaction(tx)

    await upsertBookingAftercare(
      makeValidArgs({
        rebookMode: AftercareRebookMode.NONE,
        rebookedFor: null,
        rebookSlot: null,
      }),
    )

    expect(tx.aftercareRebookSlot.upsert).not.toHaveBeenCalled()
    expect(tx.aftercareRebookSlot.deleteMany).toHaveBeenCalledWith({
      where: {
        aftercareSummaryId: aftercareId,
      },
    })
  })
})