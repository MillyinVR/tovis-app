import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingServiceItemType,
  BookingStatus,
  ConsultationApprovalStatus,
  ConsultationDecision,
  ContactMethod,
  Prisma,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')
const BOOKING_ID = 'booking_1'
const CLIENT_ID = 'client_1'
const PROFESSIONAL_ID = 'pro_1'
const RECORDED_BY_USER_ID = 'user_pro_1'
const LOCATION_TIME_ZONE = 'America/Los_Angeles'
const SCHEDULED_FOR = new Date('2026-03-20T18:00:00.000Z')
const RAW_TOKEN = 'raw_consultation_token'
const TOKEN_ID = 'client_action_token_1'
const DESTINATION_EMAIL = 'client@example.com'

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

  createProNotification: vi.fn(),
  upsertClientNotification: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
  cancelBookingAppointmentReminders: vi.fn(),

  consumeConsultationActionToken: vi.fn(),
  revokeConsultationActionTokensForBooking: vi.fn(),

  createConsultationApprovalProof: vi.fn(),
  buildConsultationApprovalProofSnapshot: vi.fn(),
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
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: mocks.cancelBookingAppointmentReminders,
}))

vi.mock('@/lib/consultation/clientActionTokens', () => ({
  consumeConsultationActionToken: mocks.consumeConsultationActionToken,
  revokeConsultationActionTokensForBooking:
    mocks.revokeConsultationActionTokensForBooking,
}))

vi.mock('@/lib/consultation/consultationConfirmationProof', () => ({
  createConsultationApprovalProof: mocks.createConsultationApprovalProof,
  buildConsultationApprovalProofSnapshot:
    mocks.buildConsultationApprovalProofSnapshot,
}))

import {
  approveConsultationAndMaterializeBooking,
  approveConsultationByClientActionToken,
  rejectConsultationByClientActionToken,
  recordInPersonConsultationDecision,
} from './writeBoundary'

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

function hasConsultationApprovalSelect(
  record: Record<string, unknown> | undefined,
): boolean {
  return isRecord(record?.consultationApproval)
}

function makePendingApprovalBooking(overrides?: {
  proposedServicesJson?: Prisma.JsonValue
  status?: ConsultationApprovalStatus
  proof?: Record<string, unknown> | null
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
      proof: overrides?.proof ?? null,
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

function makeInPersonOwnershipBooking() {
  return {
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    professionalId: PROFESSIONAL_ID,
  }
}

function makeProofResult(args?: {
  decision?: ConsultationDecision
  method?: 'REMOTE_SECURE_LINK' | 'IN_PERSON_PRO_DEVICE'
  recordedByUserId?: string | null
  clientActionTokenId?: string | null
  contactMethod?: ContactMethod | null
  destinationSnapshot?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}) {
  return {
    id: 'proof_1',
    consultationApprovalId: 'approval_1',
    bookingId: BOOKING_ID,
    clientId: CLIENT_ID,
    professionalId: PROFESSIONAL_ID,
    decision: args?.decision ?? ConsultationDecision.APPROVED,
    method: args?.method ?? 'REMOTE_SECURE_LINK',
    actedAt: TEST_NOW,
    recordedByUserId: args?.recordedByUserId ?? null,
    clientActionTokenId: args?.clientActionTokenId ?? null,
    contactMethod: args?.contactMethod ?? null,
    destinationSnapshot: args?.destinationSnapshot ?? null,
    ipAddress: args?.ipAddress ?? null,
    userAgent: args?.userAgent ?? null,
    contextJson: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  }
}

function installBookingFindUniqueMocks(args?: {
  consultationBooking?: ReturnType<typeof makePendingApprovalBooking>
  includeInPersonOwnershipLookup?: boolean
}) {
  const consultationBooking = args?.consultationBooking ?? makePendingApprovalBooking()
  const checkoutRollupBooking = makeCheckoutRollupBooking()
  const reminderSyncBooking = makeReminderSyncBooking()
  const inPersonOwnershipBooking = makeInPersonOwnershipBooking()

  mocks.txBookingFindUnique.mockImplementation(
    async (callArgs?: { select?: Record<string, unknown> }) => {
      const select = isRecord(callArgs?.select) ? callArgs.select : undefined

      if (
        args?.includeInPersonOwnershipLookup &&
        hasTrueFlag(select, 'id') &&
        hasTrueFlag(select, 'clientId') &&
        hasTrueFlag(select, 'professionalId') &&
        !hasConsultationApprovalSelect(select)
      ) {
        return inPersonOwnershipBooking
      }

      if (hasConsultationApprovalSelect(select)) {
        return consultationBooking
      }

      if (hasTrueFlag(select, 'checkoutStatus')) {
        return checkoutRollupBooking
      }

      if (hasServiceNameSelect(select)) {
        return reminderSyncBooking
      }

      return null
    },
  )
}

function installApprovedMutationMocks() {
  const computedSubtotal = new Prisma.Decimal(125)
  const basePrice = new Prisma.Decimal(100)
  const addOnPrice = new Prisma.Decimal(25)

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

  return {
    computedSubtotal,
    basePrice,
    addOnPrice,
  }
}

describe('lib/booking/writeBoundary consultation decisions', () => {
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

    mocks.syncBookingAppointmentReminders.mockResolvedValue(undefined)
    mocks.cancelBookingAppointmentReminders.mockResolvedValue(undefined)

    mocks.revokeConsultationActionTokensForBooking.mockResolvedValue({
      count: 0,
    })

    mocks.buildConsultationApprovalProofSnapshot.mockImplementation((proof) => {
      if (!isRecord(proof)) return null
      return {
        decision: proof.decision ?? null,
        method: proof.method ?? null,
        actedAt: proof.actedAt ?? null,
        recordedByUserId: proof.recordedByUserId ?? null,
        clientActionTokenId: proof.clientActionTokenId ?? null,
        contactMethod: proof.contactMethod ?? null,
        destinationSnapshot: proof.destinationSnapshot ?? null,
      }
    })

    mocks.createConsultationApprovalProof.mockImplementation(
      async (args: Record<string, unknown>) =>
        makeProofResult({
          decision:
            (args.decision as ConsultationDecision | undefined) ??
            ConsultationDecision.APPROVED,
          method:
            (args.method as 'REMOTE_SECURE_LINK' | 'IN_PERSON_PRO_DEVICE' | undefined) ??
            'REMOTE_SECURE_LINK',
          recordedByUserId:
            (args.recordedByUserId as string | null | undefined) ?? null,
          clientActionTokenId:
            (args.clientActionTokenId as string | null | undefined) ?? null,
          contactMethod:
            (args.contactMethod as ContactMethod | null | undefined) ?? null,
          destinationSnapshot:
            (args.destinationSnapshot as string | null | undefined) ?? null,
          ipAddress: (args.ipAddress as string | null | undefined) ?? null,
          userAgent: (args.userAgent as string | null | undefined) ?? null,
        }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('materializes approved consultation from proposedServicesJson.items into canonical booking state', async () => {
    const { computedSubtotal, basePrice, addOnPrice } =
      installApprovedMutationMocks()

    installBookingFindUniqueMocks()

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

    expect(mocks.createConsultationApprovalProof).toHaveBeenCalledWith({
      tx,
      consultationApprovalId: 'approval_1',
      bookingId: BOOKING_ID,
      clientId: CLIENT_ID,
      professionalId: PROFESSIONAL_ID,
      decision: ConsultationDecision.APPROVED,
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
    })

    expect(mocks.syncBookingAppointmentReminders).toHaveBeenCalledWith({
      tx,
      bookingId: BOOKING_ID,
    })

    expect(
      mocks.revokeConsultationActionTokensForBooking,
    ).toHaveBeenCalledWith({
      tx,
      bookingId: BOOKING_ID,
      revokeReason: 'Consultation decision completed.',
      revokedAt: TEST_NOW,
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
        decision: ConsultationDecision.APPROVED,
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
      installBookingFindUniqueMocks({
        consultationBooking: makePendingApprovalBooking({
          proposedServicesJson,
        }),
      })

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
      expect(mocks.createConsultationApprovalProof).not.toHaveBeenCalled()
      expect(mocks.syncBookingAppointmentReminders).not.toHaveBeenCalled()
      expect(
        mocks.revokeConsultationActionTokensForBooking,
      ).not.toHaveBeenCalled()
    },
  )

  it('throws INVALID_SERVICE_ITEMS when a proposed item is missing offeringId', async () => {
    installBookingFindUniqueMocks({
      consultationBooking: makePendingApprovalBooking({
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
    })

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
    expect(mocks.createConsultationApprovalProof).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when the consultation approval is no longer pending', async () => {
    installBookingFindUniqueMocks({
      consultationBooking: makePendingApprovalBooking({
        status: ConsultationApprovalStatus.APPROVED,
      }),
    })

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
    expect(mocks.createConsultationApprovalProof).not.toHaveBeenCalled()
  })

  it('approves consultation through a client action token', async () => {
    const { computedSubtotal } = installApprovedMutationMocks()
    installBookingFindUniqueMocks()

    mocks.consumeConsultationActionToken.mockResolvedValueOnce({
      id: TOKEN_ID,
      bookingId: BOOKING_ID,
      consultationApprovalId: 'approval_1',
      clientId: CLIENT_ID,
      professionalId: PROFESSIONAL_ID,
      deliveryMethod: ContactMethod.EMAIL,
      destinationSnapshot: DESTINATION_EMAIL,
      expiresAt: new Date('2026-03-21T16:00:00.000Z'),
      firstUsedAt: TEST_NOW,
      lastUsedAt: TEST_NOW,
      useCount: 1,
    })

    const result = await approveConsultationByClientActionToken({
      rawToken: RAW_TOKEN,
      requestId: 'req_approve_token',
      idempotencyKey: 'idem_approve_token',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    })

    expect(mocks.consumeConsultationActionToken).toHaveBeenCalledWith({
      rawToken: RAW_TOKEN,
    })

    expect(mocks.createConsultationApprovalProof).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        consultationApprovalId: 'approval_1',
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        professionalId: PROFESSIONAL_ID,
        decision: ConsultationDecision.APPROVED,
        method: 'REMOTE_SECURE_LINK',
        recordedByUserId: null,
        clientActionTokenId: TOKEN_ID,
        contactMethod: ContactMethod.EMAIL,
        destinationSnapshot: DESTINATION_EMAIL,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      }),
    )

    expect(result.approval.status).toBe(ConsultationApprovalStatus.APPROVED)
    expect(result.proof.clientActionTokenId).toBe(TOKEN_ID)
    expect(result.proof.contactMethod).toBe(ContactMethod.EMAIL)
    expect(result.proof.destinationSnapshot).toBe(DESTINATION_EMAIL)
    expect(result.booking.subtotalSnapshot).toEqual(computedSubtotal)
  })

  it('rejects consultation through a client action token', async () => {
    installBookingFindUniqueMocks()

    mocks.consumeConsultationActionToken.mockResolvedValueOnce({
      id: TOKEN_ID,
      bookingId: BOOKING_ID,
      consultationApprovalId: 'approval_1',
      clientId: CLIENT_ID,
      professionalId: PROFESSIONAL_ID,
      deliveryMethod: ContactMethod.EMAIL,
      destinationSnapshot: DESTINATION_EMAIL,
      expiresAt: new Date('2026-03-21T16:00:00.000Z'),
      firstUsedAt: TEST_NOW,
      lastUsedAt: TEST_NOW,
      useCount: 1,
    })

    mocks.txConsultationApprovalUpdate.mockResolvedValueOnce({
      id: 'approval_1',
      status: ConsultationApprovalStatus.REJECTED,
      approvedAt: null,
      rejectedAt: TEST_NOW,
    })

    mocks.createConsultationApprovalProof.mockResolvedValueOnce(
      makeProofResult({
        decision: ConsultationDecision.REJECTED,
        method: 'REMOTE_SECURE_LINK',
        clientActionTokenId: TOKEN_ID,
        contactMethod: ContactMethod.EMAIL,
        destinationSnapshot: DESTINATION_EMAIL,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      }),
    )

    const result = await rejectConsultationByClientActionToken({
      rawToken: RAW_TOKEN,
      requestId: 'req_reject_token',
      idempotencyKey: 'idem_reject_token',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    })

    expect(mocks.consumeConsultationActionToken).toHaveBeenCalledWith({
      rawToken: RAW_TOKEN,
    })

    expect(mocks.txConsultationApprovalUpdate).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID },
      data: {
        status: ConsultationApprovalStatus.REJECTED,
        approvedAt: null,
        rejectedAt: TEST_NOW,
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

    expect(mocks.createConsultationApprovalProof).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        consultationApprovalId: 'approval_1',
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        professionalId: PROFESSIONAL_ID,
        decision: ConsultationDecision.REJECTED,
        method: 'REMOTE_SECURE_LINK',
        recordedByUserId: null,
        clientActionTokenId: TOKEN_ID,
        contactMethod: ContactMethod.EMAIL,
        destinationSnapshot: DESTINATION_EMAIL,
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      }),
    )

    expect(mocks.syncBookingAppointmentReminders).not.toHaveBeenCalled()

    expect(result).toEqual({
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.REJECTED,
        approvedAt: null,
        rejectedAt: TEST_NOW,
      },
      proof: {
        id: 'proof_1',
        decision: ConsultationDecision.REJECTED,
        method: 'REMOTE_SECURE_LINK',
        actedAt: TEST_NOW,
        recordedByUserId: null,
        clientActionTokenId: TOKEN_ID,
        contactMethod: ContactMethod.EMAIL,
        destinationSnapshot: DESTINATION_EMAIL,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('records an in-person approved consultation decision on the pro device', async () => {
    const { computedSubtotal } = installApprovedMutationMocks()
    installBookingFindUniqueMocks({
      includeInPersonOwnershipLookup: true,
    })

    mocks.createConsultationApprovalProof.mockResolvedValueOnce(
      makeProofResult({
        decision: ConsultationDecision.APPROVED,
        method: 'IN_PERSON_PRO_DEVICE',
        recordedByUserId: RECORDED_BY_USER_ID,
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
        userAgent: 'iPad kiosk',
      }),
    )

const result = await recordInPersonConsultationDecision({
  bookingId: BOOKING_ID,
  professionalId: PROFESSIONAL_ID,
  recordedByUserId: RECORDED_BY_USER_ID,
  decision: ConsultationDecision.APPROVED,
  requestId: 'req_in_person_approve',
  idempotencyKey: 'idem_in_person_approve',
  userAgent: 'iPad kiosk',
})

expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
  PROFESSIONAL_ID,
  expect.any(Function),
)

expect(mocks.createConsultationApprovalProof).toHaveBeenCalledWith(
  expect.objectContaining({
    tx,
    consultationApprovalId: 'approval_1',
    bookingId: BOOKING_ID,
    clientId: CLIENT_ID,
    professionalId: PROFESSIONAL_ID,
    decision: ConsultationDecision.APPROVED,
    method: 'IN_PERSON_PRO_DEVICE',
    recordedByUserId: RECORDED_BY_USER_ID,
    clientActionTokenId: null,
    contactMethod: null,
    destinationSnapshot: null,
    ipAddress: null,
    userAgent: 'iPad kiosk',
  }),
)

expect(result.proof.method).toBe('IN_PERSON_PRO_DEVICE')
expect(result.proof.recordedByUserId).toBe(RECORDED_BY_USER_ID)
expect('booking' in result).toBe(true)

if (!('booking' in result)) {
  throw new Error('Expected approved in-person consultation result to include booking.')
}

expect(result.booking.subtotalSnapshot).toEqual(computedSubtotal)
  })

  it('records an in-person rejected consultation decision on the pro device', async () => {
    installBookingFindUniqueMocks({
      includeInPersonOwnershipLookup: true,
    })

    mocks.txConsultationApprovalUpdate.mockResolvedValueOnce({
      id: 'approval_1',
      status: ConsultationApprovalStatus.REJECTED,
      approvedAt: null,
      rejectedAt: TEST_NOW,
    })

    mocks.createConsultationApprovalProof.mockResolvedValueOnce(
      makeProofResult({
        decision: ConsultationDecision.REJECTED,
        method: 'IN_PERSON_PRO_DEVICE',
        recordedByUserId: RECORDED_BY_USER_ID,
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
        userAgent: 'iPad kiosk',
      }),
    )

    const result = await recordInPersonConsultationDecision({
      bookingId: BOOKING_ID,
      professionalId: PROFESSIONAL_ID,
      recordedByUserId: RECORDED_BY_USER_ID,
      decision: ConsultationDecision.REJECTED,
      requestId: 'req_in_person_reject',
      idempotencyKey: 'idem_in_person_reject',
      userAgent: 'iPad kiosk',
    })

    expect(mocks.txConsultationApprovalUpdate).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID },
      data: {
        status: ConsultationApprovalStatus.REJECTED,
        approvedAt: null,
        rejectedAt: TEST_NOW,
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

    expect(mocks.createConsultationApprovalProof).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        consultationApprovalId: 'approval_1',
        bookingId: BOOKING_ID,
        clientId: CLIENT_ID,
        professionalId: PROFESSIONAL_ID,
        decision: ConsultationDecision.REJECTED,
        method: 'IN_PERSON_PRO_DEVICE',
        recordedByUserId: RECORDED_BY_USER_ID,
        clientActionTokenId: null,
        contactMethod: null,
        destinationSnapshot: null,
        ipAddress: null,
        userAgent: 'iPad kiosk',
      }),
    )

    expect(result).toEqual({
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.REJECTED,
        approvedAt: null,
        rejectedAt: TEST_NOW,
      },
      proof: {
        id: 'proof_1',
        decision: ConsultationDecision.REJECTED,
        method: 'IN_PERSON_PRO_DEVICE',
        actedAt: TEST_NOW,
        recordedByUserId: RECORDED_BY_USER_ID,
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
})