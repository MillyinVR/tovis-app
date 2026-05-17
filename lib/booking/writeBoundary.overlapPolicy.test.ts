// lib/booking/writeBoundary.overlapPolicy.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const TEST_NOW = new Date('2026-04-12T18:00:00.000Z')
const REQUESTED_START = new Date('2030-05-01T18:00:00.000Z')
const REQUESTED_END = new Date('2030-05-01T19:15:00.000Z')
const HOLD_EXPIRES_AT = new Date('2026-04-12T18:10:00.000Z')

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),

  checkProReadinessForEntryPointWithDb: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),
  evaluateHoldCreationDecision: vi.fn(),
  evaluateFinalizeDecision: vi.fn(),
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

  txBookingServiceItemCreate: vi.fn(),
  txBookingServiceItemCreateMany: vi.fn(),

  txLastMinuteOpeningFindFirst: vi.fn(),
  txLastMinuteOpeningUpdateMany: vi.fn(),
  txLastMinuteRecipientUpdateMany: vi.fn(),

  txOfferingAddOnFindMany: vi.fn(),
  txProfessionalServiceOfferingFindMany: vi.fn(),
  txClientAddressFindFirst: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),

  txProfessionalProfileUpdate: vi.fn(),
  txExecuteRaw: vi.fn(),
  txQueryRaw: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction: vi.fn(),
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
    $transaction: vi.fn(),
  },
}))

import { createHold, finalizeBookingFromHold } from './writeBoundary'

const tx = {
  bookingHold: {
    create: mocks.txBookingHoldCreate,
    findUnique: mocks.txBookingHoldFindUnique,
    delete: mocks.txBookingHoldDelete,
  },
  booking: {
    create: mocks.txBookingCreate,
    findFirst: mocks.txBookingFindFirst,
  },
  bookingServiceItem: {
    create: mocks.txBookingServiceItemCreate,
    createMany: mocks.txBookingServiceItemCreateMany,
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
  professionalServiceOffering: {
    findMany: mocks.txProfessionalServiceOfferingFindMany,
  },
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
  professionalProfile: {
    findUnique: mocks.txProfessionalProfileFindUnique,
    update: mocks.txProfessionalProfileUpdate,
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

function mockLockedProfessionalTransaction() {
  mocks.withLockedProfessionalTransaction.mockImplementation(
    async (
      _professionalId: string,
      run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
    ) => run({ tx, now: TEST_NOW }),
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

function mockNoConflictsAllowed() {
  mocks.findSchedulingConflicts.mockResolvedValue({
    all: [],
  })

  mocks.decideBookingOverlapPermission.mockReturnValue({
    ok: true,
  })
}

describe('lib/booking/writeBoundary overlap policy wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    mockLockedProfessionalTransaction()
    mockReadinessOk()
    mockValidatedContextOk()
    mockHoldPolicyOk()
    mockFinalizePolicyOk()
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

    mocks.txOfferingAddOnFindMany.mockResolvedValue([])
    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValue([])

    mocks.txBookingCreate.mockResolvedValue({
      id: 'booking_1',
      status: BookingStatus.PENDING,
      scheduledFor: REQUESTED_START,
      professionalId: 'pro_1',
    })

    mocks.txBookingServiceItemCreate.mockResolvedValue({
      id: 'booking_service_item_1',
    })

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

    mocks.txExecuteRaw.mockResolvedValue(1)
    mocks.txQueryRaw.mockResolvedValue([])
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
      booking: {
        id: 'booking_1',
        status: BookingStatus.PENDING,
        scheduledFor: REQUESTED_START,
        professionalId: 'pro_1',
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
      startsAt: REQUESTED_START,
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
})