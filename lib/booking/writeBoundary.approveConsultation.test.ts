import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  ClientActionTokenKind,
  ConsultationApprovalStatus,
  Prisma,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')
const BOOKING_ID = 'booking_1'
const CLIENT_ID = 'client_1'
const PROFESSIONAL_ID = 'pro_1'
const LOCATION_TIME_ZONE = 'America/Los_Angeles'
const SCHEDULED_FOR = new Date('2026-03-20T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),
  prismaBookingUpdateMany: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),

  buildNormalizedBookingItemsFromRequestedOfferings: vi.fn(),
  computeBookingItemLikeTotals: vi.fn(),
  snapToStepMinutes: vi.fn((value: number) => value),

  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),

  txProfessionalServiceOfferingFindMany: vi.fn(),

  txBookingServiceItemDeleteMany: vi.fn(),
  txBookingServiceItemCreate: vi.fn(),
  txBookingServiceItemCreateMany: vi.fn(),

  txConsultationApprovalUpdate: vi.fn(),
  txBookingCloseoutAuditLogCreate: vi.fn(),
  txConsultationApprovalProofCreate: vi.fn(),
  txClientActionTokenUpdateMany: vi.fn(),

  createProNotification: vi.fn(),
  upsertClientNotification: vi.fn(),
  scheduleClientNotification: vi.fn(),
  cancelScheduledClientNotificationsForBooking: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
      updateMany: mocks.prismaBookingUpdateMany,
    },
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/serviceItems', () => ({
  buildNormalizedBookingItemsFromRequestedOfferings:
    mocks.buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals: mocks.computeBookingItemLikeTotals,
  snapToStepMinutes: mocks.snapToStepMinutes,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
  scheduleClientNotification: mocks.scheduleClientNotification,
  cancelScheduledClientNotificationsForBooking:
    mocks.cancelScheduledClientNotificationsForBooking,
}))

import { approveConsultationAndMaterializeBooking } from './writeBoundary'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  professionalServiceOffering: {
    findMany: mocks.txProfessionalServiceOfferingFindMany,
  },
  bookingServiceItem: {
    deleteMany: mocks.txBookingServiceItemDeleteMany,
    create: mocks.txBookingServiceItemCreate,
    createMany: mocks.txBookingServiceItemCreateMany,
  },
  consultationApproval: {
    update: mocks.txConsultationApprovalUpdate,
  },
  consultationApprovalProof: {
    create: mocks.txConsultationApprovalProofCreate,
  },
  clientActionToken: {
    updateMany: mocks.txClientActionTokenUpdateMany,
  },
  bookingCloseoutAuditLog: {
    create: mocks.txBookingCloseoutAuditLogCreate,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasTrueFlag(
  record: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return record?.[key] === true
}

function hasServiceNameSelect(
  record: Record<string, unknown> | undefined,
): boolean {
  if (!record) return false

  const service = record.service
  if (!isRecord(service)) return false

  const nestedSelect = service.select
  if (!isRecord(nestedSelect)) return false

  return nestedSelect.name === true
}

function makePendingApprovalBooking(overrides?: {
  proposedServicesJson?: Prisma.JsonValue
  status?: ConsultationApprovalStatus
}) {
  return {
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    professionalId: PROFESSIONAL_ID,
    locationType: ServiceLocationType.SALON,
    serviceId: null,
    offeringId: null,
    scheduledFor: SCHEDULED_FOR,
    subtotalSnapshot: null,
    totalDurationMinutes: 60,
    consultationConfirmedAt: null,
    consultationApproval: {
      id: 'approval_1',
      status: overrides?.status ?? ConsultationApprovalStatus.PENDING,
      proposedServicesJson:
        overrides?.proposedServicesJson ??
        ({
          currency: 'USD',
          items: [
            {
              offeringId: 'off_base',
              sortOrder: 0,
            },
            {
              offeringId: 'off_addon',
              sortOrder: 1,
            },
          ],
        } satisfies Prisma.JsonObject),
      proposedTotal: null,
      notes: null,
      approvedAt: null,
      rejectedAt: null,
      clientId: null,
      proId: null,
      proof: null,
    },
  }
}

function makeCheckoutRollupBooking() {
  return {
    id: BOOKING_ID,
    professionalId: PROFESSIONAL_ID,
    status: BookingStatus.ACCEPTED,
    sessionStep: SessionStep.CONSULTATION_PENDING_CLIENT,
    finishedAt: null,
    subtotalSnapshot: null,
    serviceSubtotalSnapshot: null,
    productSubtotalSnapshot: null,
    tipAmount: null,
    taxAmount: null,
    discountAmount: null,
    totalAmount: null,
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    selectedPaymentMethod: null,
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,
    aftercareSummary: null,
    productSales: [],
  }
}

function makeReminderSyncBooking() {
  return {
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    scheduledFor: SCHEDULED_FOR,
    status: BookingStatus.ACCEPTED,
    finishedAt: null,
    locationTimeZone: LOCATION_TIME_ZONE,
    service: {
      name: 'Haircut',
    },
  }
}

function installHappyPathBookingFindUniqueMocks() {
  const pendingApprovalBooking = makePendingApprovalBooking()
  const checkoutRollupBooking = makeCheckoutRollupBooking()
  const reminderSyncBooking = makeReminderSyncBooking()

  mocks.txBookingFindUnique.mockImplementation(
    async (args?: { select?: Record<string, unknown> }) => {
      const select = isRecord(args?.select) ? args.select : undefined

      if (isRecord(select?.consultationApproval)) {
        return pendingApprovalBooking
      }

      if (hasTrueFlag(select, 'checkoutStatus')) {
        return checkoutRollupBooking
      }

      if (hasServiceNameSelect(select)) {
        return reminderSyncBooking
      }

      if (hasTrueFlag(select, 'id') && hasTrueFlag(select, 'clientId')) {
        return {
          id: BOOKING_ID,
          clientId: CLIENT_ID,
        }
      }

      return null
    },
  )
}

describe('lib/booking/writeBoundary approveConsultationAndMaterializeBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: TEST_NOW }),
    )

    mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
      async ({
        run,
      }: {
        bookingId: string
        clientId: string
        run: (ctx: {
          tx: typeof tx
          now: Date
          professionalId: string
        }) => Promise<unknown>
      }) => run({ tx, now: TEST_NOW, professionalId: PROFESSIONAL_ID }),
    )

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.createProNotification.mockResolvedValue(undefined)
    mocks.upsertClientNotification.mockResolvedValue({ id: 'client_notif_1' })
    mocks.scheduleClientNotification.mockResolvedValue({ id: 'scheduled_1' })
    mocks.cancelScheduledClientNotificationsForBooking.mockResolvedValue({
      count: 0,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('materializes approved consultation from proposedServicesJson.items into canonical booking state', async () => {
    const computedSubtotal = new Prisma.Decimal(125)
    const basePrice = new Prisma.Decimal(100)
    const addOnPrice = new Prisma.Decimal(25)

    installHappyPathBookingFindUniqueMocks()

    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValueOnce([
      {
        id: 'off_base',
        serviceId: 'svc_base',
        offersInSalon: true,
        offersMobile: false,
        salonDurationMinutes: 60,
        mobileDurationMinutes: null,
        salonPriceStartingAt: basePrice,
        mobilePriceStartingAt: null,
        service: {
          defaultDurationMinutes: 60,
          name: 'Haircut',
        },
      },
      {
        id: 'off_addon',
        serviceId: 'svc_addon',
        offersInSalon: true,
        offersMobile: false,
        salonDurationMinutes: 15,
        mobileDurationMinutes: null,
        salonPriceStartingAt: addOnPrice,
        mobilePriceStartingAt: null,
        service: {
          defaultDurationMinutes: 15,
          name: 'Haircut Add-On',
        },
      },
    ])

    mocks.buildNormalizedBookingItemsFromRequestedOfferings.mockReturnValueOnce([
      {
        serviceId: 'svc_base',
        offeringId: 'off_base',
        priceSnapshot: basePrice,
        durationMinutesSnapshot: 60,
      },
      {
        serviceId: 'svc_addon',
        offeringId: 'off_addon',
        priceSnapshot: addOnPrice,
        durationMinutesSnapshot: 15,
      },
    ])

    mocks.computeBookingItemLikeTotals.mockReturnValueOnce({
      primaryServiceId: 'svc_base',
      primaryOfferingId: 'off_base',
      computedDurationMinutes: 75,
      computedSubtotal,
    })

    mocks.txBookingServiceItemDeleteMany.mockResolvedValueOnce({ count: 0 })

    mocks.txBookingServiceItemCreate.mockResolvedValueOnce({
      id: 'bsi_base_1',
    })

    mocks.txBookingServiceItemCreateMany.mockResolvedValueOnce({
      count: 1,
    })

    mocks.txBookingUpdate.mockResolvedValueOnce({
      id: BOOKING_ID,
      serviceId: 'svc_base',
      offeringId: 'off_base',
      subtotalSnapshot: computedSubtotal,
      totalDurationMinutes: 75,
      consultationConfirmedAt: TEST_NOW,
    })

    mocks.txConsultationApprovalUpdate.mockResolvedValueOnce({
      id: 'approval_1',
      status: ConsultationApprovalStatus.APPROVED,
      approvedAt: TEST_NOW,
      rejectedAt: null,
    })

        mocks.txConsultationApprovalProofCreate.mockResolvedValueOnce({
      id: 'proof_1',
      consultationApprovalId: 'approval_1',
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      professionalId: PROFESSIONAL_ID,
      decision: 'APPROVED',
      method: 'REMOTE_SECURE_LINK',
      actedAt: TEST_NOW,
      recordedByUserId: null,
      clientActionTokenId: null,
      contactMethod: null,
      destinationSnapshot: null,
      ipAddress: null,
      userAgent: null,
      contextJson: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    })

    mocks.txClientActionTokenUpdateMany.mockResolvedValueOnce({
      count: 0,
    })

    const result = await approveConsultationAndMaterializeBooking({
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      professionalId: PROFESSIONAL_ID,
    })

    expect(
      mocks.withLockedClientOwnedBookingTransaction,
    ).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      run: expect.any(Function),
    })

    const normalizeCall =
      mocks.buildNormalizedBookingItemsFromRequestedOfferings.mock.calls[0]?.[0]

    expect(normalizeCall.requestedItems).toEqual([
      {
        serviceId: 'svc_base',
        offeringId: 'off_base',
        sortOrder: 0,
      },
      {
        serviceId: 'svc_addon',
        offeringId: 'off_addon',
        sortOrder: 1,
      },
    ])
    expect(normalizeCall.locationType).toBe(ServiceLocationType.SALON)
    expect(normalizeCall.stepMinutes).toBe(15)
    expect(normalizeCall.badItemsCode).toBe('INVALID_SERVICE_ITEMS')
    expect(Array.from(normalizeCall.offeringById.keys())).toEqual([
      'off_base',
      'off_addon',
    ])

    expect(mocks.txBookingServiceItemDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID },
    })

    expect(mocks.txBookingServiceItemCreate).toHaveBeenCalledWith({
      data: {
        bookingId: BOOKING_ID,
        serviceId: 'svc_base',
        offeringId: 'off_base',
        itemType: BookingServiceItemType.BASE,
        parentItemId: null,
        priceSnapshot: basePrice,
        durationMinutesSnapshot: 60,
        sortOrder: 0,
      },
      select: { id: true },
    })

    expect(mocks.txBookingServiceItemCreateMany).toHaveBeenCalledWith({
      data: [
        {
          bookingId: BOOKING_ID,
          serviceId: 'svc_addon',
          offeringId: 'off_addon',
          itemType: BookingServiceItemType.ADD_ON,
          parentItemId: 'bsi_base_1',
          priceSnapshot: addOnPrice,
          durationMinutesSnapshot: 15,
          sortOrder: 1,
          notes: 'CONSULTATION_APPROVED',
        },
      ],
    })

    const bookingUpdateArgs = mocks.txBookingUpdate.mock.calls[0]?.[0]
    expect(bookingUpdateArgs.where).toEqual({ id: BOOKING_ID })
    expect(bookingUpdateArgs.data.serviceId).toBe('svc_base')
    expect(bookingUpdateArgs.data.offeringId).toBe('off_base')
    expect(bookingUpdateArgs.data.totalDurationMinutes).toBe(75)
    expect(bookingUpdateArgs.data.consultationConfirmedAt).toEqual(TEST_NOW)
    expect(bookingUpdateArgs.data.subtotalSnapshot.toString()).toBe('125')
    expect(bookingUpdateArgs.data.serviceSubtotalSnapshot.toString()).toBe('125')
    expect(bookingUpdateArgs.data.productSubtotalSnapshot.toString()).toBe('0')
    expect(bookingUpdateArgs.data.tipAmount.toString()).toBe('0')
    expect(bookingUpdateArgs.data.taxAmount.toString()).toBe('0')
    expect(bookingUpdateArgs.data.discountAmount.toString()).toBe('0')
    expect(bookingUpdateArgs.data.totalAmount.toString()).toBe('125')

    expect(mocks.txConsultationApprovalUpdate).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID },
      data: {
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: TEST_NOW,
        rejectedAt: null,
        clientId: CLIENT_ID,
        proId: PROFESSIONAL_ID,
      },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        rejectedAt: true,
      },
    })

        expect(mocks.txConsultationApprovalProofCreate).toHaveBeenCalledWith({
      data: {
        consultationApprovalId: 'approval_1',
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        professionalId: PROFESSIONAL_ID,
        decision: 'APPROVED',
        method: 'REMOTE_SECURE_LINK',
        recordedByUserId: null,
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
        ipAddress: null,
        userAgent: null,
        contextJson: {
          bookingId: BOOKING_ID,
          requestId: null,
          idempotencyKey: null,
          source: 'approveConsultationAndMaterializeBooking',
        },
        actedAt: TEST_NOW,
      },
      select: expect.any(Object),
    })

        expect(mocks.txClientActionTokenUpdateMany).toHaveBeenCalledWith({
      where: {
        bookingId: BOOKING_ID,
        kind: ClientActionTokenKind.CONSULTATION_ACTION,
        revokedAt: null,
        firstUsedAt: null,
      },
      data: {
        revokedAt: TEST_NOW,
        revokeReason: 'Consultation decision completed.',
      },
    })

    expect(
      mocks.cancelScheduledClientNotificationsForBooking,
    ).toHaveBeenCalledWith({
      tx,
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      eventKeys: [expect.any(String)],
      onlyPending: true,
    })

    expect(mocks.scheduleClientNotification).toHaveBeenCalledTimes(1)
    expect(mocks.scheduleClientNotification).toHaveBeenCalledWith({
      tx,
      clientId: CLIENT_ID,
      bookingId: BOOKING_ID,
      eventKey: expect.any(String),
      runAt: expect.any(Date),
      dedupeKey: expect.stringContaining(BOOKING_ID),
      href: `/client/bookings/${BOOKING_ID}?step=overview`,
      data: expect.objectContaining({
        bookingId: BOOKING_ID,
        serviceName: 'Haircut',
      }),
    })

    expect(result).toEqual({
      booking: {
        id: BOOKING_ID,
        serviceId: 'svc_base',
        offeringId: 'off_base',
        subtotalSnapshot: computedSubtotal,
        totalDurationMinutes: 75,
        consultationConfirmedAt: TEST_NOW,
      },
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: TEST_NOW,
        rejectedAt: null,
      },
      proof: {
        id: 'proof_1',
        decision: 'APPROVED',
        method: 'REMOTE_SECURE_LINK',
        actedAt: TEST_NOW,
        recordedByUserId: null,
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it.each([
    {
      label: 'missing items',
      proposedServicesJson: {
        currency: 'USD',
      } satisfies Prisma.JsonObject,
    },
    {
      label: 'empty items',
      proposedServicesJson: {
        currency: 'USD',
        items: [],
      } satisfies Prisma.JsonObject,
    },
  ])(
    'throws INVALID_SERVICE_ITEMS when proposedServicesJson has $label',
    async ({ proposedServicesJson }) => {
      mocks.txBookingFindUnique.mockResolvedValueOnce(
        makePendingApprovalBooking({
          proposedServicesJson,
        }),
      )

      await expect(
        approveConsultationAndMaterializeBooking({
          bookingId: BOOKING_ID,
          clientId: CLIENT_ID,
          professionalId: PROFESSIONAL_ID,
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_SERVICE_ITEMS',
      })

      expect(mocks.txProfessionalServiceOfferingFindMany).not.toHaveBeenCalled()
      expect(mocks.txBookingServiceItemDeleteMany).not.toHaveBeenCalled()
      expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
      expect(mocks.txConsultationApprovalUpdate).not.toHaveBeenCalled()
      expect(
        mocks.cancelScheduledClientNotificationsForBooking,
      ).not.toHaveBeenCalled()
      expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
    },
  )

  it('throws INVALID_SERVICE_ITEMS when a proposed item is missing offeringId', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makePendingApprovalBooking({
        proposedServicesJson: {
          currency: 'USD',
          items: [
            {
              offeringId: '   ',
              sortOrder: 0,
            },
          ],
        } satisfies Prisma.JsonObject,
      }),
    )

    await expect(
      approveConsultationAndMaterializeBooking({
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        professionalId: PROFESSIONAL_ID,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SERVICE_ITEMS',
    })

    expect(mocks.txProfessionalServiceOfferingFindMany).not.toHaveBeenCalled()
    expect(mocks.txBookingServiceItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txConsultationApprovalUpdate).not.toHaveBeenCalled()
    expect(
      mocks.cancelScheduledClientNotificationsForBooking,
    ).not.toHaveBeenCalled()
    expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when the consultation approval is no longer pending', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makePendingApprovalBooking({
        status: ConsultationApprovalStatus.APPROVED,
      }),
    )

    await expect(
      approveConsultationAndMaterializeBooking({
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        professionalId: PROFESSIONAL_ID,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txProfessionalServiceOfferingFindMany).not.toHaveBeenCalled()
    expect(mocks.txBookingServiceItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txConsultationApprovalUpdate).not.toHaveBeenCalled()
    expect(
      mocks.cancelScheduledClientNotificationsForBooking,
    ).not.toHaveBeenCalled()
    expect(mocks.scheduleClientNotification).not.toHaveBeenCalled()
  })
})