// lib/booking/writeBoundary.overlapPolicy.integration.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  LastMinuteOfferType,
  LastMinuteTier,
  ProfessionalLocationType,
  ServiceLocationType,
  WaitlistOfferStatus,
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

  findBookingAndHoldConflicts: vi.fn(),
  decideBookingOverlapPermission: vi.fn(),

  computeLastMinuteDiscount: vi.fn(),

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

    waitlistOffer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },

    waitlistEntry: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },

    professionalLocation: {
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

vi.mock('@/lib/booking/overlapPolicy', () => ({
  decideBookingOverlapPermission: mocks.decideBookingOverlapPermission,
}))

vi.mock('@/lib/booking/conflictQueries', async () => {
  const actual = await vi.importActual<object>(
    '@/lib/booking/conflictQueries',
  )
  return {
    ...actual,
    findBookingAndHoldConflicts: mocks.findBookingAndHoldConflicts,
  }
})

vi.mock('@/lib/lastMinutePricing', () => ({
  computeLastMinuteDiscount: mocks.computeLastMinuteDiscount,
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
  confirmClientWaitlistOffer,
  createHold,
  createProBooking,
  createWaitlistOffer,
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

    mocks.findBookingAndHoldConflicts.mockResolvedValue({
      all: [],
    })

    mocks.decideBookingOverlapPermission.mockReturnValue({
      ok: true,
      mode: 'NO_OVERLAP',
      conflicts: [],
    })

    // Default: no opening incentive (zero discount). Tests that exercise a discount override this.
    mocks.computeLastMinuteDiscount.mockResolvedValue({
      discountAmount: 0,
      discountedPrice: 100,
      appliedPct: 0,
      window: null,
      reason: null,
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
    expect(mocks.findBookingAndHoldConflicts).not.toHaveBeenCalled()
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

    expect(mocks.findBookingAndHoldConflicts).toHaveBeenCalledOnce()
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

    expect(mocks.findBookingAndHoldConflicts).toHaveBeenCalledOnce()
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
      visibilityMode: 'TARGETED_ONLY',
      timeZone: 'America/Los_Angeles',
      services: [{ offeringId: 'offering_1', serviceId: 'service_1' }],
      tierPlans: [],
      recipients: [],
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

  it('applies the opening incentive: PERCENT_OFF for a notified recipient discounts the booking', async () => {
    mocks.prisma.lastMinuteOpening.findFirst.mockResolvedValue({
      id: 'opening_1',
      startAt: new Date('2030-05-01T18:00:00.000Z'),
      professionalId: 'pro_1',
      visibilityMode: 'TARGETED_ONLY',
      timeZone: 'America/Los_Angeles',
      services: [{ offeringId: 'offering_1', serviceId: 'service_1' }],
      tierPlans: [
        {
          tier: LastMinuteTier.WAITLIST,
          scheduledFor: new Date('2030-05-01T00:00:00.000Z'),
          offerType: LastMinuteOfferType.PERCENT_OFF,
          percentOff: 20,
          amountOff: null,
        },
      ],
      recipients: [
        { notifiedTier: LastMinuteTier.WAITLIST, firstMatchedTier: LastMinuteTier.WAITLIST },
      ],
    })
    mocks.prisma.lastMinuteOpening.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.lastMinuteRecipient.updateMany.mockResolvedValue({ count: 0 })
    // base subtotal is 100.00 (validatedContext priceStartingAt) → 20% off = 20 discount.
    mocks.computeLastMinuteDiscount.mockResolvedValue({
      discountAmount: 20,
      discountedPrice: 80,
      appliedPct: 20,
      window: 'OPENING_TIER',
      reason: null,
    })

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

    // The incentive was resolved from the recipient's tier and passed to the discount calc.
    expect(mocks.computeLastMinuteDiscount).toHaveBeenCalledWith(
      expect.objectContaining({
        offerType: LastMinuteOfferType.PERCENT_OFF,
        percentOff: 20,
        serviceId: 'service_1',
        professionalId: 'pro_1',
      }),
    )

    const createArgs = mocks.prisma.booking.create.mock.calls[0]?.[0] as {
      data: { discountAmount: { toString(): string }; totalAmount: { toString(): string } }
    }
    expect(createArgs.data.discountAmount.toString()).toBe('20')
    expect(createArgs.data.totalAmount.toString()).toBe('80')
  })

  it('does not discount a booking with no openingId (regression)', async () => {
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

    expect(mocks.computeLastMinuteDiscount).not.toHaveBeenCalled()
    const createArgs = mocks.prisma.booking.create.mock.calls[0]?.[0] as {
      data: { discountAmount: { toString(): string }; totalAmount: { toString(): string } }
    }
    expect(createArgs.data.discountAmount.toString()).toBe('0')
    expect(createArgs.data.totalAmount.toString()).toBe('100')
  })

  function setupConfirmableWaitlistOffer() {
    mocks.prisma.waitlistOffer.findUnique.mockResolvedValue({
      id: 'offer_1',
      status: WaitlistOfferStatus.PENDING,
      clientId: 'client_1',
      professionalId: 'pro_1',
      waitlistEntryId: 'entry_1',
      offeringId: 'offering_1',
      locationId: 'location_1',
      locationType: ServiceLocationType.SALON,
      startsAt: new Date('2030-05-01T18:00:00.000Z'),
      durationMinutes: 60,
      expiresAt: new Date('2030-05-02T17:00:00.000Z'),
      bookingId: null,
      professional: { userId: 'pro_user_1' },
    })
    mocks.prisma.waitlistOffer.update.mockResolvedValue({ id: 'offer_1' })
    mocks.prisma.waitlistEntry.update.mockResolvedValue({ id: 'entry_1' })
  }

  it('waitlist confirm runs the overlap policy as the CLIENT, not the pro', async () => {
    setupValidProCreateInputs()
    setupConfirmableWaitlistOffer()

    await confirmClientWaitlistOffer({
      offerId: 'offer_1',
      clientId: 'client_1',
    })

    expect(mocks.decideBookingOverlapPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({
          kind: 'CLIENT',
          clientId: 'client_1',
        }),
        source: expect.objectContaining({
          kind: 'PRO_CREATED',
        }),
      }),
    )
  })

  it('waitlist confirm refuses with TIME_BOOKED when the offered slot is no longer free', async () => {
    setupValidProCreateInputs()
    setupConfirmableWaitlistOffer()

    mocks.decideBookingOverlapPermission.mockReturnValue({
      ok: false,
      code: 'CLIENT_OVERLAP_NOT_ALLOWED',
      userMessage: 'That time is no longer available. Please choose another time.',
      conflicts: [
        {
          kind: 'BOOKING',
          id: 'booking_other',
          professionalId: 'pro_1',
          startsAt: new Date('2030-05-01T18:00:00.000Z'),
          endsAt: new Date('2030-05-01T19:00:00.000Z'),
        },
      ],
    })

    await expect(
      confirmClientWaitlistOffer({ offerId: 'offer_1', clientId: 'client_1' }),
    ).rejects.toMatchObject({ code: 'TIME_BOOKED' })

    expect(mocks.prisma.booking.create).not.toHaveBeenCalled()
    expect(mocks.prisma.waitlistOffer.update).not.toHaveBeenCalled()
    expect(mocks.prisma.waitlistEntry.update).not.toHaveBeenCalled()
  })

  function setupOfferableWaitlistEntry() {
    mocks.prisma.waitlistEntry.findFirst.mockResolvedValue({
      id: 'entry_1',
      clientId: 'client_1',
      serviceId: 'service_1',
    })
    mocks.prisma.professionalServiceOffering.findFirst.mockResolvedValue({
      id: 'offering_1',
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: 60,
      mobileDurationMinutes: null,
      salonPriceStartingAt: '100.00',
      mobilePriceStartingAt: null,
      service: { name: 'Haircut' },
      professional: {
        businessName: 'Salon',
        displayName: 'Pro',
        timeZone: 'America/Los_Angeles',
      },
    })
    mocks.prisma.professionalLocation.findFirst.mockResolvedValue({
      id: 'location_1',
      type: ProfessionalLocationType.SALON,
    })
    mocks.prisma.waitlistOffer.create.mockResolvedValue({
      id: 'offer_1',
      status: WaitlistOfferStatus.PENDING,
      startsAt: new Date('2030-05-01T18:00:00.000Z'),
      endsAt: new Date('2030-05-01T19:00:00.000Z'),
      locationType: ServiceLocationType.SALON,
    })
    mocks.prisma.waitlistOffer.updateMany.mockResolvedValue({ count: 0 })
    mocks.prisma.waitlistEntry.update.mockResolvedValue({ id: 'entry_1' })
    // F14: the offer supersedes any live one for the entry (releasing its
    // reservation first) and then reserves the slot it just promised.
    mocks.prisma.waitlistOffer.findMany.mockResolvedValue([])
    mocks.prisma.bookingHold.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.bookingHold.create.mockResolvedValue({ id: 'hold_offer_1' })
  }

  const OFFER_ARGS = {
    professionalId: 'pro_1',
    actorUserId: 'user_1',
    waitlistEntryId: 'entry_1',
    scheduledFor: new Date('2030-05-01T18:00:00.000Z'),
    endsAt: new Date('2030-05-01T19:00:00.000Z'),
    locationId: 'location_1',
    locationType: ServiceLocationType.SALON,
    durationMinutes: 60,
  } as const

  it('waitlist offer creation refuses when the window already conflicts', async () => {
    setupOfferableWaitlistEntry()
    mocks.evaluateProSchedulingDecision.mockResolvedValue({
      ok: false,
      code: 'TIME_BOOKED',
      logHint: {
        requestedStart: new Date('2030-05-01T18:00:00.000Z'),
        requestedEnd: new Date('2030-05-01T19:15:00.000Z'),
        conflictType: 'BOOKING',
      },
    })

    const conflictLines: string[] = []
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...parts: unknown[]) => {
        conflictLines.push(parts.map((part) => String(part)).join(' '))
      })

    try {
      await expect(
        createWaitlistOffer({ ...OFFER_ARGS }),
      ).rejects.toMatchObject({ code: 'TIME_BOOKED' })
    } finally {
      warnSpy.mockRestore()
    }

    // The offer gate and the booking-create gate are the same function, so the
    // trail has to say which one refused: nothing was being booked here.
    const conflict = conflictLines
      .map((line) => {
        try {
          return JSON.parse(line) as { event?: string; action?: string }
        } catch {
          return null
        }
      })
      .find((parsed) => parsed?.event === 'booking_conflict')
    expect(conflict?.action).toBe('WAITLIST_OFFER_CREATE')

    expect(mocks.prisma.waitlistOffer.updateMany).not.toHaveBeenCalled()
    expect(mocks.prisma.waitlistOffer.create).not.toHaveBeenCalled()
  })

  // F5. The offer is a promise, so it must run the client confirm's own gate
  // with the client confirm's own flags. Each literal below is load-bearing in a
  // different direction and none of them is visible from a refusal:
  //   • allow* true would let the pro author a time the confirm then refuses;
  //   • enforceStepGrid true would refuse a minute only the PRO can change;
  //   • deferBusyConflicts true would stop the offer refusing a taken slot,
  //     because no overlap policy runs here to pick the verdict up.
  it('waitlist offer creation runs the confirm’s gate with the confirm’s flags', async () => {
    setupOfferableWaitlistEntry()

    const result = await createWaitlistOffer({ ...OFFER_ARGS })
    expect(result.offer.id).toBe('offer_1')

    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        locationId: 'location_1',
        requestedStart: new Date('2030-05-01T18:00:00.000Z'),
        // Duration from the OFFERING (60) + the location's buffer (15) — the
        // window the confirm reserves, not the caller's raw start/end pair.
        durationMinutes: 60,
        bufferMinutes: 15,
        allowOutsideWorkingHours: false,
        allowShortNotice: false,
        allowFarFuture: false,
        enforceStepGrid: false,
        deferBusyConflictsToOverlapPolicy: false,
      }),
    )
  })

  // The confirm opens with this same readiness gate, so a not-ready pro who can
  // still send offers is sending offers that can only fail. Refuse to the pro.
  it('waitlist offer creation refuses when the pro is not booking-ready', async () => {
    setupOfferableWaitlistEntry()
    mocks.checkProReadinessForEntryPointWithDb.mockResolvedValue({
      ok: false,
      blockers: ['NO_BOOKABLE_LOCATION'],
    })

    await expect(createWaitlistOffer({ ...OFFER_ARGS })).rejects.toMatchObject({
      code: 'PRO_NOT_READY',
    })
    expect(mocks.prisma.waitlistOffer.create).not.toHaveBeenCalled()
  })

  // The offer's stored window must be the one that was validated, or the client
  // is shown (and promised) a different appointment from the one that books.
  it('stores the offering-derived window, not a shorter requested one', async () => {
    setupOfferableWaitlistEntry()

    await createWaitlistOffer({ ...OFFER_ARGS, durationMinutes: 30 })

    expect(mocks.prisma.waitlistOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          durationMinutes: 60,
          endsAt: new Date('2030-05-01T19:00:00.000Z'),
        }),
      }),
    )
    expect(mocks.evaluateProSchedulingDecision).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 60 }),
    )
  })
})