// lib/booking/writeBoundary.approveConsultation.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  Prisma,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')

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
  bookingCloseoutAuditLog: {
    create: mocks.txBookingCloseoutAuditLogCreate,
  },
}

function makePendingApprovalBooking(overrides?: {
  proposedServicesJson?: Prisma.JsonValue
  status?: ConsultationApprovalStatus
}) {
  return {
    id: 'booking_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    locationType: ServiceLocationType.SALON,
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
    },
  }
}

function makeCheckoutRollupBooking() {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
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
      }) => run({ tx, now: TEST_NOW, professionalId: 'pro_1' }),
    )

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )
  })

  it('materializes approved consultation from proposedServicesJson.items into canonical booking state', async () => {
    const computedSubtotal = new Prisma.Decimal(125)
    const basePrice = new Prisma.Decimal(100)
    const addOnPrice = new Prisma.Decimal(25)

    mocks.txBookingFindUnique
      .mockResolvedValueOnce(makePendingApprovalBooking())
      .mockResolvedValueOnce(makeCheckoutRollupBooking())

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
      id: 'booking_1',
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

    const result = await approveConsultationAndMaterializeBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    expect(
      mocks.withLockedClientOwnedBookingTransaction,
    ).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
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
      where: { bookingId: 'booking_1' },
    })

    expect(mocks.txBookingServiceItemCreate).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking_1',
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
          bookingId: 'booking_1',
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
    expect(bookingUpdateArgs.where).toEqual({ id: 'booking_1' })
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
      where: { bookingId: 'booking_1' },
      data: {
        status: ConsultationApprovalStatus.APPROVED,
        approvedAt: TEST_NOW,
        rejectedAt: null,
        clientId: 'client_1',
        proId: 'pro_1',
      },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        rejectedAt: true,
      },
    })

    expect(result).toEqual({
      booking: {
        id: 'booking_1',
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
          bookingId: 'booking_1',
          clientId: 'client_1',
          professionalId: 'pro_1',
        }),
      ).rejects.toMatchObject({
        code: 'INVALID_SERVICE_ITEMS',
      })

      expect(mocks.txProfessionalServiceOfferingFindMany).not.toHaveBeenCalled()
      expect(mocks.txBookingServiceItemDeleteMany).not.toHaveBeenCalled()
      expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
      expect(mocks.txConsultationApprovalUpdate).not.toHaveBeenCalled()
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
        bookingId: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SERVICE_ITEMS',
    })

    expect(mocks.txProfessionalServiceOfferingFindMany).not.toHaveBeenCalled()
    expect(mocks.txBookingServiceItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txConsultationApprovalUpdate).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when the consultation approval is no longer pending', async () => {
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makePendingApprovalBooking({
        status: ConsultationApprovalStatus.APPROVED,
      }),
    )

    await expect(
      approveConsultationAndMaterializeBooking({
        bookingId: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })

    expect(mocks.txProfessionalServiceOfferingFindMany).not.toHaveBeenCalled()
    expect(mocks.txBookingServiceItemDeleteMany).not.toHaveBeenCalled()
    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txConsultationApprovalUpdate).not.toHaveBeenCalled()
  })
})