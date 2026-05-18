// lib/booking/writeBoundary.overlapPolicy.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingSource,
  BookingStatus,
  BookingServiceItemType,
  PaymentMethod,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')
const REQUESTED_START = new Date('2030-05-01T18:00:00.000Z')
const REQUESTED_END = new Date('2030-05-01T19:15:00.000Z')
const HOLD_EXPIRES_AT = new Date('2026-04-12T18:10:00.000Z')

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),
  prismaTransaction: vi.fn(),
  checkProReadinessForEntryPointWithDb: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),
  evaluateHoldCreationDecision: vi.fn(),
  evaluateFinalizeDecision: vi.fn(),
  evaluateRescheduleDecision: vi.fn(),
  decideBookingOverlapPermission: vi.fn(),
  findSchedulingConflicts: vi.fn(),
  logBookingConflict: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
  bumpScheduleVersion: vi.fn(),

  deleteExpiredHoldsForProfessional: vi.fn(),
  deleteActiveHoldsForClient: vi.fn(),

  resolveAftercarePreselectedSlot: vi.fn(),

  txBookingHoldCreate: vi.fn(),
  txBookingHoldFindUnique: vi.fn(),
  txBookingHoldDelete: vi.fn(),

  txBookingCreate: vi.fn(),
  txBookingFindFirst: vi.fn(),
  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),

  txBookingServiceItemCreate: vi.fn(),
  txBookingServiceItemCreateMany: vi.fn(),
  txBookingServiceItemFindMany: vi.fn(),

  txAftercareSummaryFindUnique: vi.fn(),
  txAftercareSummaryUpsert: vi.fn(),

  txLastMinuteOpeningFindFirst: vi.fn(),
  txLastMinuteOpeningUpdateMany: vi.fn(),
  txLastMinuteRecipientUpdateMany: vi.fn(),

  txOfferingAddOnFindMany: vi.fn(),
  txProfessionalServiceOfferingFindMany: vi.fn(),
  txProfessionalServiceOfferingFindUnique: vi.fn(),

  txClientAddressFindFirst: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),
  txProfessionalProfileUpdate: vi.fn(),
  txProfessionalLocationFindFirst: vi.fn(),

  txExecuteRaw: vi.fn(),
  txQueryRaw: vi.fn(),

  txClientProfileFindUnique: vi.fn(),
  txProfessionalServiceOfferingFindFirst: vi.fn(),
  createBookingOverrideAuditRows: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),
  assertCanUseBookingOverride: vi.fn(),
  upsertClientNotification: vi.fn(),

  resolveAppointmentSchedulingContext: vi.fn(),
  evaluateProSchedulingDecision: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: vi.fn(),
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadinessForEntryPointWithDb:
    mocks.checkProReadinessForEntryPointWithDb,
}))

vi.mock('@/lib/booking/locationContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/booking/locationContext')>(
      '@/lib/booking/locationContext',
    )

  return {
    ...actual,
    resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
  }
})

vi.mock('@/lib/booking/policies/holdPolicy', () => ({
  evaluateHoldCreationDecision: mocks.evaluateHoldCreationDecision,
}))

vi.mock('@/lib/booking/policies/finalizePolicy', () => ({
  evaluateFinalizeDecision: mocks.evaluateFinalizeDecision,
}))

vi.mock('@/lib/booking/policies/reschedulePolicy', () => ({
  evaluateRescheduleDecision: mocks.evaluateRescheduleDecision,
}))

vi.mock('@/lib/booking/overlapPolicy', () => ({
  decideBookingOverlapPermission: mocks.decideBookingOverlapPermission,
}))

vi.mock('@/lib/booking/schedulingConflicts', () => ({
  findSchedulingConflicts: mocks.findSchedulingConflicts,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
  bumpScheduleConfigVersion: vi.fn(),
}))

vi.mock('@/lib/booking/holdCleanup', () => ({
  deleteExpiredHoldsForProfessional: mocks.deleteExpiredHoldsForProfessional,
  deleteActiveHoldsForClient: mocks.deleteActiveHoldsForClient,
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: vi.fn(),
}))

vi.mock('@/lib/booking/aftercarePreselectedSlot', () => ({
  resolveAftercarePreselectedSlot: mocks.resolveAftercarePreselectedSlot,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
  },
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveAppointmentSchedulingContext: mocks.resolveAppointmentSchedulingContext,
}))

vi.mock('@/lib/booking/policies/proSchedulingPolicy', () => ({
  evaluateProSchedulingDecision: mocks.evaluateProSchedulingDecision,
}))

vi.mock('@/lib/booking/overrideAudit', () => ({
  buildBookingOverrideAuditRows: mocks.createBookingOverrideAuditRows,
}))

vi.mock('@/lib/booking/closeoutAudit', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/booking/closeoutAudit')>(
      '@/lib/booking/closeoutAudit',
    )

  return {
    ...actual,
    createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
  }
})

vi.mock('@/lib/booking/overrideAuthorization', () => ({
  assertCanUseBookingOverride: mocks.assertCanUseBookingOverride,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

import {
  createClientRebookedBookingFromAftercare,
  createHold,
  createProBooking,
  finalizeBookingFromHold,
  rescheduleBookingFromHold,
  updateProBooking,
} from './writeBoundary'

const tx = {
  bookingHold: {
    create: mocks.txBookingHoldCreate,
    findUnique: mocks.txBookingHoldFindUnique,
    delete: mocks.txBookingHoldDelete,
  },
  booking: {
    create: mocks.txBookingCreate,
    findFirst: mocks.txBookingFindFirst,
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  bookingServiceItem: {
    create: mocks.txBookingServiceItemCreate,
    createMany: mocks.txBookingServiceItemCreateMany,
    findMany: mocks.txBookingServiceItemFindMany,
  },
  aftercareSummary: {
    findUnique: mocks.txAftercareSummaryFindUnique,
    upsert: mocks.txAftercareSummaryUpsert,
  },
  clientProfile: {
    findUnique: mocks.txClientProfileFindUnique,
  },
  professionalLocation: {
    findFirst: mocks.txProfessionalLocationFindFirst,
  },
  professionalServiceOffering: {
    findFirst: mocks.txProfessionalServiceOfferingFindFirst,
    findMany: mocks.txProfessionalServiceOfferingFindMany,
    findUnique: mocks.txProfessionalServiceOfferingFindUnique,
  },
  lastMinuteOpening: {
    findFirst: mocks.txLastMinuteOpeningFindFirst,
    updateMany: mocks.txLastMinuteOpeningUpdateMany,
  },
  lastMinuteRecipient: {
    updateMany: mocks.txLastMinuteRecipientUpdateMany,
  },
  offeringAddOn: {
    findMany: mocks.txOfferingAddOnFindMany,
  },
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
  professionalProfile: {
    findUnique: mocks.txProfessionalProfileFindUnique,
    update: mocks.txProfessionalProfileUpdate,
  },
  bookingOverrideAuditLog: {
    createMany: vi.fn(),
  },
  $executeRaw: mocks.txExecuteRaw,
  $queryRaw: mocks.txQueryRaw,
}

function makeOffering() {
  return {
    id: 'offering_1',
    professionalId: 'pro_1',
    serviceId: 'service_1',
    offersInSalon: true,
    offersMobile: true,
    salonDurationMinutes: 60,
    mobileDurationMinutes: 75,
    salonPriceStartingAt: new Prisma.Decimal(120),
    mobilePriceStartingAt: new Prisma.Decimal(150),
    professionalTimeZone: 'America/Los_Angeles',
  }
}

function makeLocationContext() {
  return {
    locationId: 'location_1',
    timeZone: 'America/Los_Angeles',
    bufferMinutes: 15,
    workingHours: {
      monday: [{ start: '09:00', end: '17:00' }],
    },
    stepMinutes: 15,
    advanceNoticeMinutes: 60,
    maxDaysAhead: 3650,
    formattedAddress: '123 Salon St, Los Angeles, CA',
    lat: new Prisma.Decimal(34.0522),
    lng: new Prisma.Decimal(-118.2437),
  }
}

function makeHold() {
  return {
    id: 'hold_1',
    offeringId: 'offering_1',
    professionalId: 'pro_1',
    clientId: 'client_1',
    scheduledFor: REQUESTED_START,
    expiresAt: HOLD_EXPIRES_AT,
    locationType: ServiceLocationType.SALON,
    locationId: 'location_1',
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot: {
      formattedAddress: '123 Salon St, Los Angeles, CA',
    },
    locationLatSnapshot: new Prisma.Decimal(34.0522),
    locationLngSnapshot: new Prisma.Decimal(-118.2437),
    clientAddressId: null,
    clientAddressSnapshot: null,
    clientAddressLatSnapshot: null,
    clientAddressLngSnapshot: null,
  }
}

function makeCreatedBooking() {
  return {
    id: 'booking_1',
    status: BookingStatus.PENDING,
    scheduledFor: REQUESTED_START,
    professionalId: 'pro_1',
  }
}

function makeExistingBookingForUpdate() {
  return {
    id: 'booking_existing_1',
    status: BookingStatus.ACCEPTED,
    scheduledFor: new Date('2030-05-01T16:00:00.000Z'),
    locationType: ServiceLocationType.SALON,
    bufferMinutes: 15,
    totalDurationMinutes: 60,
    subtotalSnapshot: new Prisma.Decimal(120),
    clientId: 'client_1',
    locationId: 'location_1',
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot: {
      formattedAddress: '123 Salon St, Los Angeles, CA',
    },
    locationLatSnapshot: new Prisma.Decimal(34.0522),
    locationLngSnapshot: new Prisma.Decimal(-118.2437),
    serviceId: 'service_1',
    offeringId: 'offering_1',
    professionalId: 'pro_1',
    professional: {
      timeZone: 'America/Los_Angeles',
    },
  }
}

function makeExistingBookingForClientReschedule() {
  return {
    id: 'booking_existing_1',
    status: BookingStatus.ACCEPTED,
    clientId: 'client_1',
    professionalId: 'pro_1',
    offeringId: 'offering_1',
    scheduledFor: new Date('2030-05-01T16:00:00.000Z'),
    locationType: ServiceLocationType.SALON,
    locationTimeZone: 'America/Los_Angeles',
    startedAt: null,
    finishedAt: null,
    totalDurationMinutes: 60,
    bufferMinutes: 15,
  }
}

function makeCompletedSourceBookingForAftercareRebook() {
  return {
    id: 'booking_source_1',
    status: BookingStatus.COMPLETED,
    clientId: 'client_1',
    professionalId: 'pro_1',
    offeringId: 'offering_1',
    serviceId: 'service_1',
    finishedAt: new Date('2030-04-01T20:00:00.000Z'),
    checkoutStatus: BookingCheckoutStatus.PAID,
    paymentCollectedAt: new Date('2030-04-01T20:05:00.000Z'),
    aftercareSummary: {
      id: 'aftercare_1',
      sentToClientAt: new Date('2030-04-01T20:10:00.000Z'),
      rebookSlot: {
        id: 'rebook_slot_1',
        professionalId: 'pro_1',
        offeringId: 'offering_1',
        locationId: 'location_1',
        locationType: ServiceLocationType.SALON,
        startsAt: REQUESTED_START,
        endsAt: REQUESTED_END,
      },
    },

    locationType: ServiceLocationType.SALON,
    locationId: 'location_1',
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot: {
      formattedAddress: '123 Salon St, Los Angeles, CA',
    },
    locationLatSnapshot: new Prisma.Decimal(34.0522),
    locationLngSnapshot: new Prisma.Decimal(-118.2437),

    clientAddressId: null,
    clientAddressSnapshot: null,
    clientAddressLatSnapshot: null,
    clientAddressLngSnapshot: null,
    clientTimeZoneAtBooking: 'America/Los_Angeles',

    subtotalSnapshot: new Prisma.Decimal(120),
    totalAmount: new Prisma.Decimal(120),
    depositAmount: null,
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalDurationMinutes: 60,
    bufferMinutes: 15,

    serviceItems: [
      {
        serviceId: 'service_1',
        offeringId: 'offering_1',
        priceSnapshot: new Prisma.Decimal(120),
        durationMinutesSnapshot: 60,
        sortOrder: 0,
      },
    ],

    professional: {
      timeZone: 'America/Los_Angeles',
    },
  }
}

function makeCheckoutRollupBooking() {
  return {
    id: 'booking_existing_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    sessionStep: null,
    finishedAt: null,
    subtotalSnapshot: new Prisma.Decimal(120),
    serviceSubtotalSnapshot: new Prisma.Decimal(120),
    productSubtotalSnapshot: new Prisma.Decimal(0),
    tipAmount: new Prisma.Decimal(0),
    taxAmount: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    totalAmount: new Prisma.Decimal(120),
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    selectedPaymentMethod: null as PaymentMethod | null,
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,
    aftercareSummary: null,
    productSales: [],
  }
}

function makeProfessionalLocation() {
  return {
    id: 'location_1',
    type: ProfessionalLocationType.SALON,
    timeZone: 'America/Los_Angeles',
    workingHours: {
      monday: [{ start: '09:00', end: '17:00' }],
    },
    stepMinutes: 15,
    bufferMinutes: 15,
    advanceNoticeMinutes: 60,
    maxDaysAhead: 3650,
  }
}

function makeRescheduleOffering() {
  return {
    id: 'offering_1',
    offersInSalon: true,
    offersMobile: true,
    salonPriceStartingAt: new Prisma.Decimal(120),
    salonDurationMinutes: 60,
    mobilePriceStartingAt: new Prisma.Decimal(150),
    mobileDurationMinutes: 75,
    professional: {
      timeZone: 'America/Los_Angeles',
    },
  }
}

function mockLockedProfessionalTransaction() {
  mocks.withLockedProfessionalTransaction.mockImplementation(
    async (
      _professionalId: string,
      run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
    ) => run({ tx, now: TEST_NOW }),
  )
}

function mockLockedClientOwnedBookingTransaction() {
  mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
    async (args: {
      run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>
    }) => args.run({ tx, now: TEST_NOW }),
  )
}

function mockReadinessOk() {
  mocks.checkProReadinessForEntryPointWithDb.mockResolvedValue({
    ok: true,
  })
}

function mockValidatedContextOk() {
  mocks.resolveValidatedBookingContext.mockResolvedValue({
    ok: true,
    context: makeLocationContext(),
    durationMinutes: 60,
    priceStartingAt: new Prisma.Decimal(120),
  })
}

function mockHoldPolicyOk() {
  mocks.evaluateHoldCreationDecision.mockResolvedValue({
    ok: true,
    value: {
      requestedEnd: REQUESTED_END,
    },
  })
}

function mockFinalizePolicyOk() {
  mocks.evaluateFinalizeDecision.mockResolvedValue({
    ok: true,
    value: {
      requestedEnd: REQUESTED_END,
    },
  })
}

function mockReschedulePolicyOk() {
  mocks.evaluateRescheduleDecision.mockResolvedValue({
    ok: true,
    value: {
      requestedEnd: REQUESTED_END,
    },
  })
}

function mockNoConflictsAllowed() {
  mocks.findSchedulingConflicts.mockResolvedValue({
    all: [],
  })

  mocks.decideBookingOverlapPermission.mockReturnValue({
    ok: true,
  })
}

function makeProCreateOffering() {
  return {
    id: 'offering_1',
    serviceId: 'service_1',
    offersInSalon: true,
    offersMobile: true,
    salonPriceStartingAt: new Prisma.Decimal(120),
    mobilePriceStartingAt: new Prisma.Decimal(150),
    salonDurationMinutes: 60,
    mobileDurationMinutes: 75,
    professional: {
      timeZone: 'America/Los_Angeles',
    },
    service: {
      id: 'service_1',
      name: 'Haircut',
    },
  }
}

describe('lib/booking/writeBoundary overlap policy wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    vi.resetAllMocks()

    mockLockedProfessionalTransaction()
    mockLockedClientOwnedBookingTransaction()
    mocks.prismaTransaction.mockImplementation(
      async (run: (txArg: typeof tx) => Promise<unknown>) => run(tx),
    )
    mockReadinessOk()
    mockValidatedContextOk()
    mockHoldPolicyOk()
    mockFinalizePolicyOk()
    mockReschedulePolicyOk()
    mockNoConflictsAllowed()

    mocks.deleteExpiredHoldsForProfessional.mockResolvedValue(0)
    mocks.deleteActiveHoldsForClient.mockResolvedValue(0)

    mocks.txBookingHoldCreate.mockResolvedValue({
      id: 'hold_1',
      expiresAt: HOLD_EXPIRES_AT,
      scheduledFor: REQUESTED_START,
      locationType: ServiceLocationType.SALON,
      locationId: 'location_1',
      locationTimeZone: 'America/Los_Angeles',
      clientAddressId: null,
      clientAddressSnapshot: null,
    })

    mocks.txBookingHoldFindUnique.mockResolvedValue(makeHold())
    mocks.txBookingHoldDelete.mockResolvedValue(makeHold())

    // finalizeBookingFromHold uses booking.findFirst as an idempotency replay
    // check. Default must be null or finalize returns early and never reaches
    // overlap policy. updateProBooking overrides this per-test.
    mocks.txBookingFindFirst.mockResolvedValue(null)

    // buildBookingCheckoutRollupUpdate uses booking.findUnique. Client
    // reschedule overrides this per-test because that path first loads the
    // booking with a different select shape.
    mocks.txBookingFindUnique.mockResolvedValue(makeCheckoutRollupBooking())

    mocks.txOfferingAddOnFindMany.mockResolvedValue([])
    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValue([])
    mocks.txProfessionalServiceOfferingFindUnique.mockResolvedValue(
      makeRescheduleOffering(),
    )

    mocks.txAftercareSummaryFindUnique.mockResolvedValue({
      id: 'aftercare_1',
      bookingId: 'booking_source_1',
      booking: {
        id: 'booking_source_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
      },
    })

    mocks.txAftercareSummaryUpsert.mockResolvedValue({
      id: 'aftercare_1',
      rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
      rebookedFor: REQUESTED_START,
    })

    mocks.txBookingCreate.mockResolvedValue(makeCreatedBooking())

    mocks.txBookingServiceItemCreate.mockResolvedValue({
      id: 'booking_service_item_1',
    })
    mocks.txBookingServiceItemCreateMany.mockResolvedValue({
      count: 0,
    })
    mocks.txBookingServiceItemFindMany.mockResolvedValue([
      {
        serviceId: 'service_1',
        offeringId: 'offering_1',
        priceSnapshot: new Prisma.Decimal(120),
        durationMinutesSnapshot: 60,
        itemType: BookingServiceItemType.BASE,
      },
    ])

    mocks.txClientProfileFindUnique.mockResolvedValue({
      id: 'client_1',
    })

    mocks.txProfessionalServiceOfferingFindFirst.mockResolvedValue(
      makeProCreateOffering(),
    )

    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
    mocks.assertCanUseBookingOverride.mockResolvedValue(undefined)
    mocks.createBookingOverrideAuditRows.mockReturnValue([])

    mocks.syncBookingAppointmentReminders.mockResolvedValue(undefined)
    mocks.bumpScheduleVersion.mockResolvedValue(undefined)

    mocks.resolveAftercarePreselectedSlot.mockResolvedValue(null)

    mocks.txProfessionalProfileFindUnique.mockResolvedValue({
      mobileRadiusMiles: 25,
    })

    mocks.txClientAddressFindFirst.mockResolvedValue({
      id: 'client_address_1',
      formattedAddress: '456 Client St, Los Angeles, CA',
      lat: new Prisma.Decimal(34.05),
      lng: new Prisma.Decimal(-118.24),
    })

    mocks.txProfessionalProfileUpdate.mockResolvedValue({
      id: 'pro_1',
    })

    mocks.txProfessionalLocationFindFirst.mockResolvedValue(
      makeProfessionalLocation(),
    )

    mocks.resolveAppointmentSchedulingContext.mockResolvedValue({
      ok: true,
      context: {
        appointmentTimeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_LOCATION_TIME_ZONE',
      },
    })

    mocks.evaluateProSchedulingDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: REQUESTED_END,
        appliedOverrides: [],
      },
    })

    mocks.txBookingUpdate.mockResolvedValue({
      id: 'booking_existing_1',
      scheduledFor: REQUESTED_START,
      bufferMinutes: 15,
      totalDurationMinutes: 60,
      status: BookingStatus.ACCEPTED,
      subtotalSnapshot: new Prisma.Decimal(120),
      locationType: ServiceLocationType.SALON,
      locationTimeZone: 'America/Los_Angeles',
    })

    mocks.txExecuteRaw.mockResolvedValue(1)
    mocks.txQueryRaw.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not run overlap policy during hold creation because hold policy owns hold-time conflicts', async () => {
    await expect(
      createHold({
        clientId: 'client_1',
        bookingEntryPoint: 'PRO_CREATED',
        offering: makeOffering(),
        requestedStart: REQUESTED_START,
        requestedLocationId: 'location_1',
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
      }),
    ).resolves.toMatchObject({
      hold: {
        id: 'hold_1',
        scheduledFor: REQUESTED_START,
        locationType: ServiceLocationType.SALON,
        locationId: 'location_1',
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    expect(mocks.evaluateHoldCreationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        locationId: 'location_1',
        locationType: ServiceLocationType.SALON,
        offeringId: 'offering_1',
        clientId: 'client_1',
        requestedStart: REQUESTED_START,
        durationMinutes: 60,
        bufferMinutes: 15,
      }),
    )

    expect(mocks.findSchedulingConflicts).not.toHaveBeenCalled()
    expect(mocks.decideBookingOverlapPermission).not.toHaveBeenCalled()
  })

  it('allows direct-profile client finalize when overlap policy allows the requested booking window', async () => {
    await expect(
      finalizeBookingFromHold({
        clientId: 'client_1',
        bookingEntryPoint: 'PRO_CREATED',
        holdId: 'hold_1',
        aftercareClientActionTokenId: null,
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        initialStatus: BookingStatus.PENDING,
        rebookOfBookingId: null,
        fallbackTimeZone: 'UTC',
        requestId: 'req_finalize_1',
        idempotencyKey: 'idem_finalize_1',
        offering: makeOffering(),
      }),
    ).resolves.toEqual({
      booking: makeCreatedBooking(),
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_1',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
      excludeHoldId: 'hold_1',
      excludeBookingId: null,
      now: TEST_NOW,
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith({
      actor: {
        kind: 'CLIENT',
        userId: 'client_1',
        clientId: 'client_1',
      },
      source: {
        kind: 'DIRECT_PROFILE',
      },
      requestedWindow: {
        professionalId: 'pro_1',
        startsAt: REQUESTED_START,
        endsAt: REQUESTED_END,
      },
      conflicts: [],
    })

    expect(mocks.txBookingCreate).toHaveBeenCalled()
    expect(mocks.txBookingHoldDelete).toHaveBeenCalledWith({
      where: { id: 'hold_1' },
    })
  })

  it('blocks direct-profile finalize when overlap policy rejects the requested booking window', async () => {
    mocks.findSchedulingConflicts.mockResolvedValueOnce({
      all: [
        {
          kind: 'BOOKING',
          bookingId: 'existing_booking_1',
          startsAt: REQUESTED_START,
          endsAt: REQUESTED_END,
        },
      ],
    })

    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: false,
      code: 'CLIENT_OVERLAP_NOT_ALLOWED',
      userMessage: 'This client already has a booking at that time.',
      conflicts: [
        {
          kind: 'BOOKING',
          bookingId: 'existing_booking_1',
          startsAt: REQUESTED_START,
          endsAt: REQUESTED_END,
        },
      ],
    })

    await expect(
      finalizeBookingFromHold({
        clientId: 'client_1',
        bookingEntryPoint: 'PRO_CREATED',
        holdId: 'hold_1',
        aftercareClientActionTokenId: null,
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        initialStatus: BookingStatus.PENDING,
        rebookOfBookingId: null,
        fallbackTimeZone: 'UTC',
        requestId: 'req_finalize_blocked_1',
        idempotencyKey: 'idem_finalize_blocked_1',
        offering: makeOffering(),
      }),
    ).rejects.toMatchObject({
      code: 'TIME_BOOKED',
      userMessage: 'This client already has a booking at that time.',
    })

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_FINALIZE',
      professionalId: 'pro_1',
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: REQUESTED_START,
      requestedEnd: REQUESTED_END,
      conflictType: 'BOOKING',
      holdId: 'hold_1',
      meta: {
        route: 'lib/booking/writeBoundary.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        overlapDecisionCode: 'CLIENT_OVERLAP_NOT_ALLOWED',
        conflictKinds: ['BOOKING'],
        sourceKind: 'DIRECT_PROFILE',
        actorKind: 'CLIENT',
      },
    })

    expect(mocks.txBookingCreate).not.toHaveBeenCalled()
    expect(mocks.txBookingHoldDelete).not.toHaveBeenCalled()
  })

  it('passes broad-discovery source into overlap policy for non-requested client finalize', async () => {
    await finalizeBookingFromHold({
      clientId: 'client_1',
      bookingEntryPoint: 'PRO_CREATED',
      holdId: 'hold_1',
      aftercareClientActionTokenId: null,
      openingId: null,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.DISCOVERY,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: null,
      fallbackTimeZone: 'UTC',
      requestId: 'req_finalize_discovery_1',
      idempotencyKey: 'idem_finalize_discovery_1',
      offering: makeOffering(),
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          kind: 'BROAD_DISCOVERY',
        },
      }),
    )
  })

  it('passes aftercare token and preselected slot into overlap policy for aftercare finalize', async () => {
    const preselectedSlot = {
      aftercareSummaryId: 'aftercare_1',
      clientActionTokenId: 'token_row_1',
      professionalId: 'pro_1',
      offeringId: 'offering_1',
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
    }

    mocks.resolveAftercarePreselectedSlot.mockResolvedValueOnce(preselectedSlot)

    await finalizeBookingFromHold({
      clientId: 'client_1',
      bookingEntryPoint: 'PRO_CREATED',
      holdId: 'hold_1',
      aftercareClientActionTokenId: 'token_row_1',
      openingId: null,
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.AFTERCARE,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: 'booking_source_1',
      fallbackTimeZone: 'UTC',
      requestId: 'req_finalize_aftercare_1',
      idempotencyKey: 'idem_finalize_aftercare_1',
      offering: makeOffering(),
    })

    expect(mocks.resolveAftercarePreselectedSlot).toHaveBeenCalledWith({
      tx,
      clientActionTokenId: 'token_row_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      bookingId: 'booking_source_1',
      now: TEST_NOW,
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          kind: 'AFTERCARE_REBOOK',
          aftercareSummaryId: 'aftercare_1',
          clientActionTokenId: 'token_row_1',
          proPreselectedSlot: preselectedSlot,
        },
      }),
    )
  })

  it('maps aftercare preselected-slot policy failures to TIME_BOOKED', async () => {
    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: false,
      code: 'AFTERCARE_PRESELECTED_SLOT_MISMATCH',
      userMessage: 'That aftercare link was for a different time.',
      conflicts: [],
    })

    await expect(
      finalizeBookingFromHold({
        clientId: 'client_1',
        bookingEntryPoint: 'PRO_CREATED',
        holdId: 'hold_1',
        aftercareClientActionTokenId: 'token_row_1',
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.AFTERCARE,
        initialStatus: BookingStatus.PENDING,
        rebookOfBookingId: 'booking_source_1',
        fallbackTimeZone: 'UTC',
        requestId: 'req_aftercare_slot_mismatch_1',
        idempotencyKey: 'idem_aftercare_slot_mismatch_1',
        offering: makeOffering(),
      }),
    ).rejects.toMatchObject({
      code: 'TIME_BOOKED',
      userMessage: 'That aftercare link was for a different time.',
    })

    expect(mocks.logBookingConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictType: 'BOOKING',
        meta: expect.objectContaining({
          overlapDecisionCode: 'AFTERCARE_PRESELECTED_SLOT_MISMATCH',
          sourceKind: 'AFTERCARE_REBOOK',
          actorKind: 'CLIENT',
        }),
      }),
    )

    expect(mocks.txBookingCreate).not.toHaveBeenCalled()
  })

  it('maps invalid booking window policy failures to INVALID_SCHEDULED_FOR', async () => {
    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: false,
      code: 'INVALID_BOOKING_WINDOW',
      userMessage: 'Booking window is invalid.',
      conflicts: [],
    })

    await expect(
      finalizeBookingFromHold({
        clientId: 'client_1',
        bookingEntryPoint: 'PRO_CREATED',
        holdId: 'hold_1',
        aftercareClientActionTokenId: null,
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        initialStatus: BookingStatus.PENDING,
        rebookOfBookingId: null,
        fallbackTimeZone: 'UTC',
        requestId: 'req_invalid_window_1',
        idempotencyKey: 'idem_invalid_window_1',
        offering: makeOffering(),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_SCHEDULED_FOR',
      userMessage: 'Booking window is invalid.',
    })

    expect(mocks.txBookingCreate).not.toHaveBeenCalled()
  })

  it('allows pro update into an overlapping booking window when overlap policy allows pro overlap', async () => {
    const existingConflict = {
      kind: 'BOOKING',
      bookingId: 'existing_booking_2',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
    }

    mocks.txBookingFindFirst.mockResolvedValueOnce(makeExistingBookingForUpdate())

    mocks.findSchedulingConflicts.mockResolvedValueOnce({
      all: [existingConflict],
    })

    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: true,
    })

    await expect(
      updateProBooking({
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
        overrideReason: null,
        bookingId: 'booking_existing_1',
        nextStatus: null,
        notifyClient: false,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
        nextStart: REQUESTED_START,
        nextBuffer: null,
        nextDuration: null,
        parsedRequestedItems: null,
        hasBuffer: false,
        hasDuration: false,
        hasServiceItems: false,
        requestId: 'req_update_overlap_1',
        idempotencyKey: 'idem_update_overlap_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_existing_1',
        scheduledFor: REQUESTED_START.toISOString(),
        status: BookingStatus.ACCEPTED,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_1',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
      excludeHoldId: null,
      excludeBookingId: 'booking_existing_1',
      now: TEST_NOW,
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith({
      actor: {
        kind: 'PRO',
        userId: 'user_pro_1',
        professionalId: 'pro_1',
      },
      source: {
        kind: 'PRO_CREATED',
      },
      requestedWindow: {
        professionalId: 'pro_1',
        startsAt: REQUESTED_START,
        endsAt: REQUESTED_END,
      },
      conflicts: [existingConflict],
    })

    expect(mocks.txBookingUpdate).toHaveBeenCalled()
  })

  it('blocks client reschedule into an overlapping booking window when overlap policy rejects it', async () => {
    const existingConflict = {
      kind: 'BOOKING',
      bookingId: 'existing_booking_2',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
    }

    // This path first uses booking.findUnique for RESCHEDULE_BOOKING_SELECT.
    // If it later reaches checkout rollup, this test should already have failed
    // because overlap policy must stop the mutation first.
    mocks.txBookingFindUnique.mockResolvedValueOnce(
      makeExistingBookingForClientReschedule(),
    )

    mocks.findSchedulingConflicts.mockResolvedValueOnce({
      all: [existingConflict],
    })

    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: false,
      code: 'CLIENT_OVERLAP_NOT_ALLOWED',
      userMessage: 'That time is already booked.',
      conflicts: [existingConflict],
    })

    await expect(
      rescheduleBookingFromHold({
        bookingId: 'booking_existing_1',
        clientId: 'client_1',
        holdId: 'hold_1',
        requestedLocationType: ServiceLocationType.SALON,
        fallbackTimeZone: 'UTC',
      }),
    ).rejects.toMatchObject({
      code: 'TIME_BOOKED',
      userMessage: 'That time is already booked.',
    })

    expect(mocks.evaluateRescheduleDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        now: TEST_NOW,
        professionalId: 'pro_1',
        bookingId: 'booking_existing_1',
        holdId: 'hold_1',
        requestedStart: REQUESTED_START,
        durationMinutes: 60,
        bufferMinutes: 15,
        locationId: 'location_1',
        timeZone: 'America/Los_Angeles',
        stepMinutes: 15,
        advanceNoticeMinutes: 60,
        maxDaysAhead: 3650,
        fallbackTimeZone: 'UTC',
      }),
    )

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_1',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
      excludeHoldId: 'hold_1',
      excludeBookingId: 'booking_existing_1',
      now: TEST_NOW,
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith({
      actor: {
        kind: 'CLIENT',
        userId: 'client_1',
        clientId: 'client_1',
      },
      source: {
        kind: 'DIRECT_PROFILE',
      },
      requestedWindow: {
        professionalId: 'pro_1',
        startsAt: REQUESTED_START,
        endsAt: REQUESTED_END,
      },
      conflicts: [existingConflict],
    })

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BOOKING_UPDATE',
      professionalId: 'pro_1',
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      requestedStart: REQUESTED_START,
      requestedEnd: REQUESTED_END,
      conflictType: 'BOOKING',
      holdId: 'hold_1',
      meta: {
        route: 'lib/booking/writeBoundary.ts',
        offeringId: 'offering_1',
        clientId: 'client_1',
        overlapDecisionCode: 'CLIENT_OVERLAP_NOT_ALLOWED',
        conflictKinds: ['BOOKING'],
        sourceKind: 'DIRECT_PROFILE',
        actorKind: 'CLIENT',
      },
    })

    expect(mocks.txBookingUpdate).not.toHaveBeenCalled()
    expect(mocks.txBookingHoldDelete).not.toHaveBeenCalled()
  })
  it('allows pro-created booking into an overlapping booking window when overlap policy allows pro overlap', async () => {
    const existingConflict = {
      kind: 'BOOKING',
      bookingId: 'existing_booking_2',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
    }

    mocks.txBookingCreate.mockResolvedValueOnce({
      id: 'booking_1',
      scheduledFor: REQUESTED_START,
      totalDurationMinutes: 60,
      bufferMinutes: 15,
      status: BookingStatus.ACCEPTED,
    })

    mocks.findSchedulingConflicts.mockResolvedValueOnce({
      all: [existingConflict],
    })

    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: true,
    })

    await expect(
      createProBooking({
        professionalId: 'pro_1',
        actorUserId: 'user_pro_1',
        overrideReason: null,
        clientId: 'client_1',
        offeringId: 'offering_1',
        locationId: 'location_1',
        locationType: ServiceLocationType.SALON,
        scheduledFor: REQUESTED_START,
        clientAddressId: null,
        internalNotes: null,
        requestedBufferMinutes: null,
        requestedTotalDurationMinutes: null,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
        requestId: 'req_pro_create_overlap_1',
        idempotencyKey: 'idem_pro_create_overlap_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_1',
        scheduledFor: REQUESTED_START,
        totalDurationMinutes: 60,
        bufferMinutes: 15,
        status: BookingStatus.ACCEPTED,
      },
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
      serviceName: 'Haircut',
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_1',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
      excludeHoldId: null,
      excludeBookingId: null,
      now: TEST_NOW,
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith({
      actor: {
        kind: 'PRO',
        userId: 'user_pro_1',
        professionalId: 'pro_1',
      },
      source: {
        kind: 'PRO_CREATED',
      },
      requestedWindow: {
        professionalId: 'pro_1',
        startsAt: REQUESTED_START,
        endsAt: REQUESTED_END,
      },
      conflicts: [existingConflict],
    })

    expect(mocks.txBookingCreate).toHaveBeenCalled()
    expect(mocks.txBookingServiceItemCreate).toHaveBeenCalled()
    expect(mocks.syncBookingAppointmentReminders).toHaveBeenCalledWith({
      tx,
      bookingId: 'booking_1',
    })
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_1')
  })
  it('passes aftercare client action token into overlap policy for client aftercare rebook creation', async () => {
    const existingConflict = {
      kind: 'BOOKING',
      bookingId: 'existing_booking_2',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
    }

    mocks.txBookingFindFirst
      .mockResolvedValueOnce(makeCompletedSourceBookingForAftercareRebook())
      .mockResolvedValueOnce(null)

    mocks.findSchedulingConflicts.mockResolvedValueOnce({
      all: [existingConflict],
    })

    mocks.decideBookingOverlapPermission.mockReturnValueOnce({
      ok: true,
    })

    mocks.txBookingCreate.mockResolvedValueOnce({
      id: 'booking_rebook_1',
      status: BookingStatus.PENDING,
      scheduledFor: REQUESTED_START,
    })

    await expect(
      createClientRebookedBookingFromAftercare({
        aftercareId: 'aftercare_1',
        bookingId: 'booking_source_1',
        clientId: 'client_1',
        aftercareClientActionTokenId: 'token_row_1',
        scheduledFor: REQUESTED_START,
        requestId: 'req_client_aftercare_rebook_1',
        idempotencyKey: 'idem_client_aftercare_rebook_1',
      }),
    ).resolves.toMatchObject({
      booking: {
        id: 'booking_rebook_1',
        status: BookingStatus.PENDING,
        scheduledFor: REQUESTED_START,
      },
      aftercare: {
        id: 'aftercare_1',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: REQUESTED_START,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_1',
      startsAt: REQUESTED_START,
      endsAt: REQUESTED_END,
      excludeHoldId: null,
      excludeBookingId: null,
      now: TEST_NOW,
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: {
          kind: 'CLIENT',
          userId: 'client_1',
          clientId: 'client_1',
        },
        source: expect.objectContaining({
          kind: 'AFTERCARE_REBOOK',
          aftercareSummaryId: 'aftercare_1',
          clientActionTokenId: 'token_row_1',
          proPreselectedSlot: expect.objectContaining({
            professionalId: 'pro_1',
            offeringId: 'offering_1',
            locationId: 'location_1',
            locationType: ServiceLocationType.SALON,
            startsAt: REQUESTED_START,
            endsAt: REQUESTED_END,
          }),
        }),
        requestedWindow: {
          professionalId: 'pro_1',
          startsAt: REQUESTED_START,
          endsAt: REQUESTED_END,
        },
        conflicts: [existingConflict],
      }),
    )

    expect(mocks.txBookingCreate).toHaveBeenCalled()
    expect(mocks.txBookingServiceItemCreate).toHaveBeenCalled()
    expect(mocks.txAftercareSummaryUpsert).toHaveBeenCalled()
    expect(mocks.syncBookingAppointmentReminders).toHaveBeenCalledWith({
      tx,
      bookingId: 'booking_rebook_1',
    })
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_1')
  })
})