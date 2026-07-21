// lib/booking/writeBoundary.consultationMaterialization.test.ts
//
// Consultation approval rewrites the booking's duration from the agreed
// services. These tests pin the overlap contract of that write: a collision
// caused by the duration growth is a PRO-authorized overlap (the pro authored
// the proposal mid-appointment), never a raw DB constraint failure.

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  Prisma,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  withLockedClientOwnedBookingTransaction: vi.fn(),
  withLockedProfessionalTransaction: vi.fn(),

  findBookingAndHoldConflicts: vi.fn(),
  hasCalendarBlockConflict: vi.fn(),
  captureOverlapBackstopFired: vi.fn(),

  createConsultationApprovalProof: vi.fn(),
  revokeConsultationActionTokensForBooking: vi.fn(),
  consumeConsultationActionToken: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
  cancelBookingAppointmentReminders: vi.fn(),

  createBookingCloseoutAuditLog: vi.fn(),
  areAuditValuesEqual: vi.fn(() => false),

  prisma: {
    $transaction: vi.fn(),

    booking: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },

    professionalServiceOffering: {
      findMany: vi.fn(),
    },

    bookingServiceItem: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },

    consultationApproval: {
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: vi.fn(),
}))

vi.mock('@/lib/booking/conflictQueries', async () => {
  const actual = await vi.importActual<object>('@/lib/booking/conflictQueries')
  return {
    ...actual,
    findBookingAndHoldConflicts: mocks.findBookingAndHoldConflicts,
    hasCalendarBlockConflict: mocks.hasCalendarBlockConflict,
  }
})

vi.mock('@/lib/consultation/clientActionTokens', async () => {
  const actual = await vi.importActual<object>(
    '@/lib/consultation/clientActionTokens',
  )
  return {
    ...actual,
    consumeConsultationActionToken: mocks.consumeConsultationActionToken,
    revokeConsultationActionTokensForBooking:
      mocks.revokeConsultationActionTokensForBooking,
  }
})

vi.mock('@/lib/consultation/consultationConfirmationProof', () => ({
  buildConsultationApprovalProofSnapshot: vi.fn(() => null),
  createConsultationApprovalProof: mocks.createConsultationApprovalProof,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  areAuditValuesEqual: mocks.areAuditValuesEqual,
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: mocks.cancelBookingAppointmentReminders,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: vi.fn(),
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: vi.fn(),
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: vi.fn(),
  bumpScheduleConfigVersion: vi.fn(),
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureOverlapBackstopFired: mocks.captureOverlapBackstopFired,
}))

import { approveConsultationAndMaterializeBooking } from './writeBoundary'

const tx = mocks.prisma
const NOW = new Date('2030-05-01T18:30:00.000Z')
const SCHEDULED_FOR = new Date('2030-05-01T18:00:00.000Z')

// 120min approved services + 15min buffer past an 18:00Z start.
const EXPECTED_MATERIALIZED_END = new Date('2030-05-01T20:15:00.000Z')
// The booking's window BEFORE approval: 30min booked + the same 15min buffer.
const EXPECTED_PREVIOUS_END = new Date('2030-05-01T18:45:00.000Z')

function setupMaterializationBooking(
  overrides: { totalDurationMinutes?: number } = {},
) {
  mocks.prisma.booking.findUnique
    // First read: the materialization's own booking select.
    .mockResolvedValueOnce({
      id: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      locationType: ServiceLocationType.SALON,
      locationId: 'location_1',
      serviceId: 'service_0',
      offeringId: 'offering_0',
      scheduledFor: SCHEDULED_FOR,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      totalDurationMinutes: overrides.totalDurationMinutes ?? 30,
      bufferMinutes: 15,
      consultationConfirmedAt: null,
      sessionStep: SessionStep.NONE,
      consultationApproval: {
        id: 'approval_1',
        status: 'PENDING',
        proposedServicesJson: {
          items: [{ offeringId: 'offering_1', itemType: 'BASE', sortOrder: 0 }],
        },
        proposedTotal: new Prisma.Decimal('100.00'),
        notes: null,
        approvedAt: null,
        rejectedAt: null,
        clientId: 'client_1',
        proId: 'pro_1',
        proof: null,
      },
    })
    // Second read: the checkout rollup's booking select.
    .mockResolvedValueOnce({
      id: 'booking_1',
      professionalId: 'pro_1',
      status: 'IN_PROGRESS',
      sessionStep: SessionStep.NONE,
      finishedAt: null,
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      serviceSubtotalSnapshot: new Prisma.Decimal('50.00'),
      productSubtotalSnapshot: new Prisma.Decimal('0'),
      tipAmount: new Prisma.Decimal('0'),
      taxAmount: new Prisma.Decimal('0'),
      discountAmount: new Prisma.Decimal('0'),
      totalAmount: new Prisma.Decimal('50.00'),
      checkoutStatus: 'NOT_STARTED',
      selectedPaymentMethod: null,
      productSales: [],
    })

  mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([
    {
      id: 'offering_1',
      serviceId: 'service_1',
      offersInSalon: true,
      offersMobile: false,
      salonDurationMinutes: 120,
      mobileDurationMinutes: null,
      salonPriceStartingAt: new Prisma.Decimal('100.00'),
      mobilePriceStartingAt: null,
      service: { defaultDurationMinutes: 60 },
    },
  ])

  mocks.prisma.bookingServiceItem.create.mockResolvedValue({ id: 'item_1' })

  mocks.prisma.booking.update.mockResolvedValue({
    id: 'booking_1',
    serviceId: 'service_1',
    offeringId: 'offering_1',
    subtotalSnapshot: new Prisma.Decimal('100.00'),
    totalDurationMinutes: 120,
    consultationConfirmedAt: NOW,
    sessionStep: SessionStep.BEFORE_PHOTOS,
  })

  mocks.prisma.consultationApproval.update.mockResolvedValue({
    id: 'approval_1',
    status: 'APPROVED',
    approvedAt: NOW,
    rejectedAt: null,
  })

  mocks.createConsultationApprovalProof.mockResolvedValue({
    id: 'proof_1',
    decision: 'APPROVED',
    method: 'REMOTE_SECURE_LINK',
    actedAt: NOW,
    recordedByUserId: null,
    clientActionTokenId: null,
    contactMethod: null,
    destinationSnapshot: null,
  })
}

describe('consultation materialization overlap contract', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.areAuditValuesEqual.mockReturnValue(false)

    mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
      async (args: {
        run: (ctx: {
          tx: typeof tx
          now: Date
          professionalId: string
        }) => unknown
      }) =>
        args.run({
          tx,
          now: NOW,
          professionalId: 'pro_1',
        }),
    )

    mocks.findBookingAndHoldConflicts.mockResolvedValue({ all: [] })
    mocks.hasCalendarBlockConflict.mockResolvedValue(false)

    setupMaterializationBooking()
  })

  it('probes the pro schedule for the FULL materialized window (duration + buffer)', async () => {
    await approveConsultationAndMaterializeBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    expect(mocks.findBookingAndHoldConflicts).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        startsAt: SCHEDULED_FOR,
        endsAt: EXPECTED_MATERIALIZED_END,
        excludeBookingId: 'booking_1',
      }),
    )
  })

  it('marks the booking allowsOverlap when the duration growth collides', async () => {
    mocks.findBookingAndHoldConflicts.mockResolvedValue({
      all: [
        {
          kind: 'BOOKING',
          id: 'booking_next',
          professionalId: 'pro_1',
          startsAt: new Date('2030-05-01T19:00:00.000Z'),
          endsAt: new Date('2030-05-01T20:00:00.000Z'),
        },
      ],
    })

    await approveConsultationAndMaterializeBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    const updateArgs = mocks.prisma.booking.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(updateArgs.data.allowsOverlap).toBe(true)
    expect(updateArgs.data.totalDurationMinutes).toBe(120)
  })

  it('leaves allowsOverlap untouched when the grown window stays clear', async () => {
    await approveConsultationAndMaterializeBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    const updateArgs = mocks.prisma.booking.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(updateArgs.data).not.toHaveProperty('allowsOverlap')
    expect(updateArgs.data.totalDurationMinutes).toBe(120)
  })

  // F2: findBookingAndHoldConflicts is block-blind, so before this the approval
  // could push an appointment straight through a calendar block. Blocks are
  // fatal on every other write path and are never override-gated.
  it('probes calendar blocks for the EXTENSION window only, not the original window', async () => {
    await approveConsultationAndMaterializeBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    expect(mocks.hasCalendarBlockConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        locationId: 'location_1',
        requestedStart: EXPECTED_PREVIOUS_END,
        requestedEnd: EXPECTED_MATERIALIZED_END,
      }),
    )
  })

  it('refuses with TIME_BLOCKED when the extension runs into blocked time', async () => {
    mocks.hasCalendarBlockConflict.mockResolvedValue(true)

    await expect(
      approveConsultationAndMaterializeBooking({
        bookingId: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
      }),
    ).rejects.toMatchObject({ code: 'TIME_BLOCKED' })

    expect(mocks.prisma.booking.update).not.toHaveBeenCalled()

    // The probe runs BEFORE the service-item rewrite. The transaction rolls the
    // refusal back either way, so this is about not spending writes we are
    // about to undo — but it only stays true if something asserts it.
    expect(mocks.prisma.bookingServiceItem.deleteMany).not.toHaveBeenCalled()
    expect(mocks.prisma.bookingServiceItem.createMany).not.toHaveBeenCalled()
  })

  // A block laid over the ALREADY-BOOKED time is a pre-existing condition the
  // client cannot act on — the ICS importer writes blocks with no booking
  // conflict check, so a migrated pro can have one over a live appointment.
  it('does not probe blocks at all when the approved services do not extend the window', async () => {
    vi.resetAllMocks()
    mocks.areAuditValuesEqual.mockReturnValue(false)
    mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
      async (args: {
        run: (ctx: {
          tx: typeof tx
          now: Date
          professionalId: string
        }) => unknown
      }) => args.run({ tx, now: NOW, professionalId: 'pro_1' }),
    )
    mocks.findBookingAndHoldConflicts.mockResolvedValue({ all: [] })
    mocks.hasCalendarBlockConflict.mockResolvedValue(true)

    // Already 120min booked; the proposal materializes the same 120min, so the
    // window does not grow and there is no new time to validate.
    setupMaterializationBooking({ totalDurationMinutes: 120 })

    await approveConsultationAndMaterializeBooking({
      bookingId: 'booking_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
    })

    expect(mocks.hasCalendarBlockConflict).not.toHaveBeenCalled()
    expect(mocks.prisma.booking.update).toHaveBeenCalled()
  })

  it('maps a raw overlap EXCLUDE rejection to a clean TIME_BOOKED', async () => {
    mocks.prisma.booking.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'exclusion constraint "Booking_no_active_professional_overlap"',
        { code: 'P2004', clientVersion: 'test' },
      ),
    )

    await expect(
      approveConsultationAndMaterializeBooking({
        bookingId: 'booking_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
      }),
    ).rejects.toMatchObject({ code: 'TIME_BOOKED' })

    // The backstop firing here means the app-level gate let the duration growth
    // through. Identical TIME_BOOKED to the client either way, so the alert is
    // the only thing that surfaces it.
    expect(mocks.captureOverlapBackstopFired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BOOKING_UPDATE',
        professionalId: 'pro_1',
        bookingId: 'booking_1',
      }),
    )
  })
})
