// lib/booking/writeBoundary.overlapPolicy.integration.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  ServiceLocationType,
} from '@prisma/client'

const TEST_AEAD_KEYRING = JSON.stringify({
  'address-aead-v1': 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
})

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),
  withLockedClientOwnedBookingTransaction: vi.fn(),
  lockProfessionalSchedule: vi.fn(),

  checkProReadinessForEntryPointWithDb: vi.fn(),

  resolveValidatedBookingContext: vi.fn(),
  evaluateFinalizeDecision: vi.fn(),
  evaluateProSchedulingDecision: vi.fn(),
  evaluateHoldCreationDecision: vi.fn(),

  findSchedulingConflicts: vi.fn(),
  decideBookingOverlapPermission: vi.fn(),

  upsertClientNotification: vi.fn(),
  createProNotification: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
  cancelBookingAppointmentReminders: vi.fn(),

  bumpScheduleVersion: vi.fn(),
  bumpScheduleConfigVersion: vi.fn(),

  deleteActiveHoldsForClient: vi.fn(),
  deleteExpiredHoldsForProfessional: vi.fn(),

  prisma: {
    $transaction: vi.fn(),

    clientProfile: {
      findUnique: vi.fn(),
    },

    bookingHold: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },

    booking: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },

    bookingServiceItem: {
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },

    lastMinuteOpening: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },

    lastMinuteRecipient: {
      updateMany: vi.fn(),
    },

    offeringAddOn: {
      findMany: vi.fn(),
    },

    professionalServiceOffering: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },

    professionalProfile: {
      findUnique: vi.fn(),
    },

    clientAddress: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: mocks.lockProfessionalSchedule,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadinessForEntryPointWithDb:
    mocks.checkProReadinessForEntryPointWithDb,
}))

vi.mock('@/lib/booking/locationContext', async () => {
  const actual = await vi.importActual<object>('@/lib/booking/locationContext')

  return {
    ...actual,
    resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
  }
})

vi.mock('@/lib/booking/policies/finalizePolicy', () => ({
  evaluateFinalizeDecision: mocks.evaluateFinalizeDecision,
}))

vi.mock('@/lib/booking/policies/proSchedulingPolicy', () => ({
  evaluateProSchedulingDecision: mocks.evaluateProSchedulingDecision,
}))

vi.mock('@/lib/booking/policies/holdPolicy', () => ({
  evaluateHoldCreationDecision: mocks.evaluateHoldCreationDecision,
}))

vi.mock('@/lib/booking/schedulingConflicts', () => ({
  findSchedulingConflicts: mocks.findSchedulingConflicts,
}))

vi.mock('@/lib/booking/overlapPolicy', () => ({
  decideBookingOverlapPermission: mocks.decideBookingOverlapPermission,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: mocks.cancelBookingAppointmentReminders,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
  bumpScheduleConfigVersion: mocks.bumpScheduleConfigVersion,
}))

vi.mock('@/lib/booking/holdCleanup', () => ({
  deleteActiveHoldsForClient: mocks.deleteActiveHoldsForClient,
  deleteExpiredHoldsForProfessional: mocks.deleteExpiredHoldsForProfessional,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({}))

import {
  createHold,
  createProBooking,
  finalizeBookingFromHold,
} from './writeBoundary'

const tx = mocks.prisma

function setupTransactionMock() {
  mocks.withLockedProfessionalTransaction.mockImplementation(
    async (
      _professionalId: string,
      run: (ctx: { tx: typeof tx; now: Date }) => unknown,
    ) =>
      run({
        tx,
        now: new Date('2030-05-01T17:00:00.000Z'),
      }),
  )

  mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
    async (args: {
      run: (ctx: { tx: typeof tx; now: Date }) => unknown
    }) =>
      args.run({
        tx,
        now: new Date('2030-05-01T17:00:00.000Z'),
      }),
  )

  mocks.prisma.$transaction.mockImplementation(
    async (run: (txArg: typeof tx) => unknown) => run(tx),
  )
}

function setupValidLocationContext() {
  mocks.resolveValidatedBookingContext.mockResolvedValue({
    ok: true,
    context: {
      locationId: 'location_1',
      timeZone: 'America/Los_Angeles',
      formattedAddress: '123 Salon St',
      lat: null,
      lng: null,
      bufferMinutes: 15,
      workingHours: [],
      stepMinutes: 15,
      advanceNoticeMinutes: 0,
      maxDaysAhead: 3650,
    },
    durationMinutes: 60,
    priceStartingAt: '100.00',
  })
}

function setupValidHold() {
  mocks.prisma.bookingHold.findUnique.mockResolvedValue({
    id: 'hold_1',
    offeringId: 'offering_1',
    professionalId: 'pro_1',
    clientId: 'client_1',
    scheduledFor: new Date('2030-05-01T18:00:00.000Z'),
    expiresAt: new Date('2030-05-01T17:10:00.000Z'),
    locationType: ServiceLocationType.SALON,
    locationId: 'location_1',
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot: null,
    locationLatSnapshot: null,
    locationLngSnapshot: null,
    clientAddressId: null,
    clientAddressSnapshot: null,
    clientAddressLatSnapshot: null,
    clientAddressLngSnapshot: null,
  })
}

function setupCreatedHold() {
  mocks.prisma.bookingHold.create.mockResolvedValue({
    id: 'hold_1',
    expiresAt: new Date('2030-05-01T17:10:00.000Z'),
    scheduledFor: new Date('2030-05-01T18:00:00.000Z'),
    locationType: ServiceLocationType.SALON,
    locationId: 'location_1',
    locationTimeZone: 'America/Los_Angeles',
    clientAddressId: null,
    clientAddressSnapshot: null,
  })
}

function setupCreatedBooking(status = BookingStatus.ACCEPTED) {
  mocks.prisma.booking.create.mockResolvedValue({
    id: 'booking_1',
    status,
    scheduledFor: new Date('2030-05-01T18:00:00.000Z'),
    professionalId: 'pro_1',
    totalDurationMinutes: 60,
    bufferMinutes: 15,
  })
}

function setupValidProCreateInputs() {
  mocks.prisma.clientProfile.findUnique.mockResolvedValue({
    id: 'client_1',
    homeTenantId: 'tenant_root',
  })

  mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
    homeTenantId: 'tenant_root',
  })

  mocks.prisma.professionalServiceOffering.findFirst.mockResolvedValue({
    id: 'offering_1',
    serviceId: 'service_1',
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: '100.00',
    mobilePriceStartingAt: null,
    salonDurationMinutes: 60,
    mobileDurationMinutes: null,
    professional: {
      timeZone: 'America/Los_Angeles',
    },
    service: {
      id: 'service_1',
      name: 'Haircut',
    },
  })
}

describe('writeBoundary overlap policy integration', () => {
  beforeEach(() => {
    process.env.PII_AEAD_KEYS_JSON = TEST_AEAD_KEYRING

    vi.resetAllMocks()

    setupTransactionMock()
    setupValidLocationContext()
    setupValidHold()
    setupCreatedHold()
    setupCreatedBooking()

    // Tenant attribution snapshots resolved at booking create.
    mocks.prisma.professionalProfile.findUnique.mockResolvedValue({
      homeTenantId: 'tenant_root',
    })
    mocks.prisma.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      homeTenantId: 'tenant_root',
    })

    mocks.checkProReadinessForEntryPointWithDb.mockResolvedValue({
      ok: true,
      blockers: [],
    })

    mocks.findSchedulingConflicts.mockResolvedValue({
      all: [],
    })

    mocks.decideBookingOverlapPermission.mockReturnValue({
      ok: true,
    })

    mocks.evaluateHoldCreationDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedStart: new Date('2030-05-01T18:00:00.000Z'),
        requestedEnd: new Date('2030-05-01T19:15:00.000Z'),
      },
    })

    mocks.evaluateFinalizeDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: new Date('2030-05-01T19:15:00.000Z'),
      },
    })

    mocks.evaluateProSchedulingDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: new Date('2030-05-01T19:15:00.000Z'),
        appliedOverrides: [],
      },
    })

    mocks.prisma.bookingServiceItem.create.mockResolvedValue({
      id: 'booking_service_item_1',
    })

    mocks.prisma.bookingHold.delete.mockResolvedValue({
      id: 'hold_1',
    })

    mocks.prisma.offeringAddOn.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])

    mocks.deleteActiveHoldsForClient.mockResolvedValue(0)
    mocks.deleteExpiredHoldsForProfessional.mockResolvedValue(0)

    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.createProNotification.mockResolvedValue(undefined)
    mocks.syncBookingAppointmentReminders.mockResolvedValue(undefined)
    mocks.bumpScheduleVersion.mockResolvedValue(undefined)
    mocks.bumpScheduleConfigVersion.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.PII_AEAD_KEYS_JSON
  })

  it('does not call overlap policy during hold creation because hold policy owns hold-time conflicts', async () => {
    await createHold({
      clientId: 'client_1',
      bookingEntryPoint: 'PRO_CREATED',
      offering: {
        id: 'offering_1',
        professionalId: 'pro_1',
        offersInSalon: true,
        offersMobile: false,
        salonDurationMinutes: 60,
        mobileDurationMinutes: null,
        salonPriceStartingAt: null,
        mobilePriceStartingAt: null,
        professionalTimeZone: 'America/Los_Angeles',
      },
      requestedStart: new Date('2030-05-01T18:00:00.000Z'),
      requestedLocationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
    })

    expect(mocks.evaluateHoldCreationDecision).toHaveBeenCalledOnce()
    expect(mocks.findSchedulingConflicts).not.toHaveBeenCalled()
    expect(mocks.decideBookingOverlapPermission).not.toHaveBeenCalled()
  })

  it('calls overlap policy when finalizing a client booking from a hold', async () => {
    await finalizeBookingFromHold({
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
      fallbackTimeZone: 'America/Los_Angeles',
      requestId: null,
      idempotencyKey: null,
      offering: {
        id: 'offering_1',
        professionalId: 'pro_1',
        serviceId: 'service_1',
        offersInSalon: true,
        offersMobile: false,
        salonPriceStartingAt: null,
        salonDurationMinutes: 60,
        mobilePriceStartingAt: null,
        mobileDurationMinutes: null,
        professionalTimeZone: 'America/Los_Angeles',
      },
    })

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledOnce()
    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledOnce()

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          kind: 'CLIENT',
          clientId: 'client_1',
        }),
        source: expect.objectContaining({
          kind: 'DIRECT_PROFILE',
        }),
        requestedWindow: expect.objectContaining({
          professionalId: 'pro_1',
          startsAt: new Date('2030-05-01T18:00:00.000Z'),
          endsAt: new Date('2030-05-01T19:15:00.000Z'),
        }),
      }),
    )
  })

  it('calls overlap policy when a pro creates a booking directly', async () => {
    setupValidProCreateInputs()

    await createProBooking({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      clientId: 'client_1',
      offeringId: 'offering_1',
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor: new Date('2030-05-01T18:00:00.000Z'),
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      requestId: null,
      idempotencyKey: null,
    })

    expect(mocks.findSchedulingConflicts).toHaveBeenCalledOnce()
    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledOnce()

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          kind: 'PRO',
          userId: 'user_1',
          professionalId: 'pro_1',
        }),
        source: expect.objectContaining({
          kind: 'PRO_CREATED',
        }),
        requestedWindow: expect.objectContaining({
          professionalId: 'pro_1',
          startsAt: new Date('2030-05-01T18:00:00.000Z'),
          endsAt: new Date('2030-05-01T19:15:00.000Z'),
        }),
      }),
    )
  })

  it('marks the opening BOOKED, books the buyer recipient, and SUPPRESSES the other recipients', async () => {
    mocks.prisma.lastMinuteOpening.findFirst.mockResolvedValue({
      id: 'opening_1',
      startAt: new Date('2030-05-01T18:00:00.000Z'),
      professionalId: 'pro_1',
      services: [{ offeringId: 'offering_1', serviceId: 'service_1' }],
    })
    // Booking wins the race for the opening.
    mocks.prisma.lastMinuteOpening.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.lastMinuteRecipient.updateMany.mockResolvedValue({ count: 0 })

    await finalizeBookingFromHold({
      clientId: 'client_1',
      bookingEntryPoint: 'PRO_CREATED',
      holdId: 'hold_1',
      aftercareClientActionTokenId: null,
      openingId: 'opening_1',
      addOnIds: [],
      locationType: ServiceLocationType.SALON,
      source: BookingSource.REQUESTED,
      initialStatus: BookingStatus.PENDING,
      rebookOfBookingId: null,
      fallbackTimeZone: 'America/Los_Angeles',
      requestId: null,
      idempotencyKey: null,
      offering: {
        id: 'offering_1',
        professionalId: 'pro_1',
        serviceId: 'service_1',
        offersInSalon: true,
        offersMobile: false,
        salonPriceStartingAt: null,
        salonDurationMinutes: 60,
        mobilePriceStartingAt: null,
        mobileDurationMinutes: null,
        professionalTimeZone: 'America/Los_Angeles',
      },
    })

    // Opening transitioned ACTIVE -> BOOKED.
    expect(mocks.prisma.lastMinuteOpening.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'opening_1', status: 'ACTIVE' }),
        data: expect.objectContaining({ status: 'BOOKED' }),
      }),
    )

    // Two recipient updates: the buyer (BOOKED) and everyone else (SUPPRESSED).
    expect(mocks.prisma.lastMinuteRecipient.updateMany).toHaveBeenCalledTimes(2)

    const recipientCalls = mocks.prisma.lastMinuteRecipient.updateMany.mock.calls.map(
      (call) => call[0] as { where: Record<string, unknown>; data: Record<string, unknown> },
    )

    const buyerCall = recipientCalls.find((c) => c.data.status === 'BOOKED')
    const suppressCall = recipientCalls.find((c) => c.data.status === 'SUPPRESSED')

    expect(buyerCall?.where).toMatchObject({
      clientId: 'client_1',
      openingId: 'opening_1',
      bookedAt: null,
    })

    expect(suppressCall?.where).toMatchObject({
      openingId: 'opening_1',
      clientId: { not: 'client_1' },
      status: { in: ['PLANNED', 'ENQUEUED', 'OPENED', 'CLICKED'] },
    })
    expect(suppressCall?.data).toMatchObject({ status: 'SUPPRESSED' })
    expect(suppressCall?.data.suppressedAt).toBeInstanceOf(Date)
  })
})