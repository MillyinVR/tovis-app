import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingCheckoutStatus,
  BookingStatus,
  Prisma,
  ProfessionalLocationType,
  ServiceLocationType,
  SessionStep,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')
const EXISTING_START = new Date('2026-03-25T16:00:00.000Z')
const EXPECTED_END = new Date('2026-03-25T17:45:00.000Z')

const mocks = vi.hoisted(() => ({
  prismaTransaction: vi.fn(),
  prismaBookingFindUnique: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

  txBookingFindFirst: vi.fn(),
  txBookingFindUnique: vi.fn(),
  txBookingUpdate: vi.fn(),

  txProfessionalLocationFindFirst: vi.fn(),
  txProfessionalServiceOfferingFindMany: vi.fn(),
  txServiceFindMany: vi.fn(),

  txBookingServiceItemFindMany: vi.fn(),
  txBookingServiceItemDeleteMany: vi.fn(),
  txBookingServiceItemCreate: vi.fn(),
  txBookingServiceItemCreateMany: vi.fn(),

  resolveAppointmentSchedulingContext: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),
  evaluateProSchedulingDecision: vi.fn(),

  buildNormalizedBookingItemsFromRequestedOfferings: vi.fn(),
  computeBookingItemLikeTotals: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
  cancelBookingAppointmentReminders: vi.fn(),

  upsertClientNotification: vi.fn(),
  createProNotification: vi.fn(),

  bumpScheduleVersion: vi.fn(),
  createBookingCloseoutAuditLog: vi.fn(),
  assertCanUseBookingOverride: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.prismaTransaction,
    booking: {
      findUnique: mocks.prismaBookingFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
  withLockedClientOwnedBookingTransaction: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleLock', () => ({
  lockProfessionalSchedule: vi.fn(),
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: mocks.cancelBookingAppointmentReminders,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveAppointmentSchedulingContext:
    mocks.resolveAppointmentSchedulingContext,
}))

vi.mock('@/lib/booking/policies/proSchedulingPolicy', () => ({
  evaluateProSchedulingDecision: mocks.evaluateProSchedulingDecision,
}))

vi.mock('@/lib/booking/serviceItems', () => ({
  buildNormalizedBookingItemsFromRequestedOfferings:
    mocks.buildNormalizedBookingItemsFromRequestedOfferings,
  computeBookingItemLikeTotals: mocks.computeBookingItemLikeTotals,
  snapToStepMinutes: (value: number) => value,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeStepMinutes: (value: number | null | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback,
  resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
}))

vi.mock('@/lib/booking/conflicts', () => ({
  addMinutes: (date: Date, minutes: number) =>
    new Date(date.getTime() + minutes * 60_000),
  durationOrFallback: (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 60,
  normalizeToMinute: (date: Date) =>
    new Date(Math.floor(date.getTime() / 60_000) * 60_000),
}))

vi.mock('@/lib/booking/snapshots', () => ({
  buildAddressSnapshot: vi.fn(),
  decimalFromUnknown: (value: unknown) =>
    new Prisma.Decimal(value as string | number),
  decimalToNullableNumber: (value: unknown) =>
    value == null ? null : Number(value),
  decimalToNumber: (value: unknown) =>
    value == null ? null : Number(value),
  pickFormattedAddressFromSnapshot: vi.fn(() => null),
}))

vi.mock('@/lib/money', () => ({
  moneyToFixed2String: (value: Prisma.Decimal | null | undefined) =>
    (value ?? new Prisma.Decimal(0)).toFixed(2),
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
}))

vi.mock('@/lib/booking/closeoutAudit', () => ({
  areAuditValuesEqual: (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right),
  createBookingCloseoutAuditLog: mocks.createBookingCloseoutAuditLog,
}))

vi.mock('@/lib/booking/overrideAuthorization', () => ({
  assertCanUseBookingOverride: mocks.assertCanUseBookingOverride,
}))

vi.mock('@/lib/booking/overrideAudit', () => ({
  buildBookingOverrideAuditRows: vi.fn(() => []),
}))

import { updateProBooking } from './writeBoundary'

const tx = {
  booking: {
    findFirst: mocks.txBookingFindFirst,
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  professionalLocation: {
    findFirst: mocks.txProfessionalLocationFindFirst,
  },
  professionalServiceOffering: {
    findMany: mocks.txProfessionalServiceOfferingFindMany,
  },
  service: {
    findMany: mocks.txServiceFindMany,
  },
  bookingServiceItem: {
    findMany: mocks.txBookingServiceItemFindMany,
    deleteMany: mocks.txBookingServiceItemDeleteMany,
    create: mocks.txBookingServiceItemCreate,
    createMany: mocks.txBookingServiceItemCreateMany,
  },
}

function buildExistingAcceptedBooking() {
  return {
    id: 'booking_1',
    status: BookingStatus.ACCEPTED,
    scheduledFor: EXISTING_START,
    locationType: ServiceLocationType.SALON,
    bufferMinutes: 15,
    totalDurationMinutes: 90,
    subtotalSnapshot: new Prisma.Decimal('100.00'),
    clientId: 'client_1',
    locationId: 'loc_1',
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot: null,
    locationLatSnapshot: null,
    locationLngSnapshot: null,
    serviceId: 'svc_old',
    offeringId: 'off_old',
    professionalId: 'pro_1',
    professional: {
      timeZone: 'America/Los_Angeles',
    },
  }
}

function buildCheckoutBookingSnapshot() {
  return {
    id: 'booking_1',
    professionalId: 'pro_1',
    status: BookingStatus.ACCEPTED,
    sessionStep: SessionStep.NONE,
    finishedAt: null,
    subtotalSnapshot: new Prisma.Decimal('100.00'),
    serviceSubtotalSnapshot: new Prisma.Decimal('100.00'),
    productSubtotalSnapshot: new Prisma.Decimal('0.00'),
    tipAmount: new Prisma.Decimal('0.00'),
    taxAmount: new Prisma.Decimal('0.00'),
    discountAmount: new Prisma.Decimal('0.00'),
    totalAmount: new Prisma.Decimal('100.00'),
    checkoutStatus: BookingCheckoutStatus.NOT_READY,
    selectedPaymentMethod: null,
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,
    aftercareSummary: null,
    productSales: [],
  }
}

function buildOffering(args: {
  id: string
  serviceId: string
  serviceName: string
  price: string
  durationMinutes: number
}) {
  return {
    id: args.id,
    professionalId: 'pro_1',
    serviceId: args.serviceId,
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal(args.price),
    salonDurationMinutes: args.durationMinutes,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    professional: {
      timeZone: 'America/Los_Angeles',
    },
    service: {
      id: args.serviceId,
      name: args.serviceName,
    },
  }
}

function buildService(id: string, name: string) {
  return {
    id,
    name,
  }
}

describe('lib/booking/writeBoundary.updateProBooking', () => {
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

    mocks.prismaTransaction.mockImplementation(
      async (run: (db: typeof tx) => Promise<unknown>) => run(tx),
    )

    mocks.resolveAppointmentSchedulingContext.mockResolvedValue({
      ok: true,
      context: {
        appointmentTimeZone: 'America/Los_Angeles',
        timeZoneSource: 'LOCATION',
      },
    })

    mocks.resolveValidatedBookingContext.mockResolvedValue({
      ok: true,
    })

    mocks.txProfessionalLocationFindFirst.mockResolvedValue({
      id: 'loc_1',
      type: ProfessionalLocationType.SALON,
      timeZone: 'America/Los_Angeles',
      workingHours: {},
      stepMinutes: 15,
      bufferMinutes: 15,
      advanceNoticeMinutes: 60,
      maxDaysAhead: 90,
    })

    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValue([
      buildOffering({
        id: 'off_old',
        serviceId: 'svc_old',
        serviceName: 'Old Service',
        price: '100.00',
        durationMinutes: 90,
      }),
    ])

    mocks.txServiceFindMany.mockResolvedValue([
      buildService('svc_old', 'Old Service'),
      buildService('svc_new', 'New Service'),
    ])

    mocks.txBookingServiceItemFindMany.mockResolvedValue([
      {
        id: 'booking_item_old',
        bookingId: 'booking_1',
        serviceId: 'svc_old',
        offeringId: 'off_old',
        itemType: 'BASE',
        parentItemId: null,
        priceSnapshot: new Prisma.Decimal('100.00'),
        durationMinutesSnapshot: 90,
        sortOrder: 0,
      },
    ])

    mocks.evaluateProSchedulingDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: EXPECTED_END,
        appliedOverrides: [],
      },
    })

    mocks.txBookingServiceItemDeleteMany.mockResolvedValue({ count: 1 })
    mocks.txBookingServiceItemCreate.mockResolvedValue({ id: 'base_item_1' })
    mocks.txBookingServiceItemCreateMany.mockResolvedValue({ count: 0 })

    mocks.txBookingFindUnique.mockResolvedValue(buildCheckoutBookingSnapshot())

    mocks.txBookingUpdate.mockResolvedValue({
      id: 'booking_1',
      scheduledFor: EXISTING_START,
      bufferMinutes: 15,
      totalDurationMinutes: 90,
      status: BookingStatus.ACCEPTED,
      subtotalSnapshot: new Prisma.Decimal('120.00'),
    })

    mocks.syncBookingAppointmentReminders.mockResolvedValue(undefined)
    mocks.cancelBookingAppointmentReminders.mockResolvedValue(undefined)
    mocks.upsertClientNotification.mockResolvedValue(undefined)
    mocks.createProNotification.mockResolvedValue(undefined)
    mocks.bumpScheduleVersion.mockResolvedValue(undefined)
    mocks.assertCanUseBookingOverride.mockResolvedValue(undefined)
    mocks.createBookingCloseoutAuditLog.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('syncs appointment reminders when accepted booking service items change without occupancy change', async () => {
    mocks.txBookingFindFirst.mockResolvedValue(buildExistingAcceptedBooking())

    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValue([
      buildOffering({
        id: 'off_new',
        serviceId: 'svc_new',
        serviceName: 'New Service',
        price: '120.00',
        durationMinutes: 90,
      }),
    ])

    mocks.buildNormalizedBookingItemsFromRequestedOfferings.mockReturnValue([
      {
        serviceId: 'svc_new',
        offeringId: 'off_new',
        durationMinutesSnapshot: 90,
        priceSnapshot: new Prisma.Decimal('120.00'),
      },
    ])

    mocks.computeBookingItemLikeTotals.mockReturnValue({
      primaryServiceId: 'svc_new',
      primaryOfferingId: 'off_new',
      computedDurationMinutes: 90,
      computedSubtotal: new Prisma.Decimal('120.00'),
    })

    const result = await updateProBooking({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      bookingId: 'booking_1',
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: null,
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: [
        {
          serviceId: 'svc_new',
          offeringId: 'off_new',
          sortOrder: 0,
        },
      ],
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: true,
    })

    expect(mocks.txProfessionalServiceOfferingFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.buildNormalizedBookingItemsFromRequestedOfferings).toHaveBeenCalledTimes(1)
    expect(mocks.computeBookingItemLikeTotals).toHaveBeenCalledTimes(1)

    expect(mocks.txBookingServiceItemDeleteMany).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
    })

    expect(mocks.txBookingServiceItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: 'booking_1',
        serviceId: 'svc_new',
        offeringId: 'off_new',
        parentItemId: null,
        priceSnapshot: new Prisma.Decimal('120.00'),
        durationMinutesSnapshot: 90,
        sortOrder: 0,
      }),
      select: { id: true },
    })

    expect(mocks.syncBookingAppointmentReminders).toHaveBeenCalledWith({
      tx,
      bookingId: 'booking_1',
    })

    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      booking: {
        id: 'booking_1',
        scheduledFor: EXISTING_START.toISOString(),
        endsAt: EXPECTED_END.toISOString(),
        bufferMinutes: 15,
        durationMinutes: 90,
        totalDurationMinutes: 90,
        status: BookingStatus.ACCEPTED,
        subtotalSnapshot: '120.00',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'LOCATION',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        locationAddressSnapshot: null,
        locationLatSnapshot: null,
        locationLngSnapshot: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('does not sync appointment reminders when accepted booking changes do not affect reminder state', async () => {
    mocks.txBookingFindFirst.mockResolvedValue(buildExistingAcceptedBooking())

    mocks.txProfessionalServiceOfferingFindMany.mockResolvedValue([
      buildOffering({
        id: 'off_old',
        serviceId: 'svc_old',
        serviceName: 'Old Service',
        price: '100.00',
        durationMinutes: 90,
      }),
    ])

    mocks.buildNormalizedBookingItemsFromRequestedOfferings.mockReturnValue([
      {
        serviceId: 'svc_old',
        offeringId: 'off_old',
        durationMinutesSnapshot: 90,
        priceSnapshot: new Prisma.Decimal('100.00'),
      },
    ])

    mocks.computeBookingItemLikeTotals.mockReturnValue({
      primaryServiceId: 'svc_old',
      primaryOfferingId: 'off_old',
      computedDurationMinutes: 90,
      computedSubtotal: new Prisma.Decimal('100.00'),
    })

    mocks.txBookingUpdate.mockResolvedValue({
      id: 'booking_1',
      scheduledFor: EXISTING_START,
      bufferMinutes: 15,
      totalDurationMinutes: 90,
      status: BookingStatus.ACCEPTED,
      subtotalSnapshot: new Prisma.Decimal('100.00'),
    })

    const result = await updateProBooking({
      professionalId: 'pro_1',
      actorUserId: 'user_1',
      overrideReason: null,
      bookingId: 'booking_1',
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: null,
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: [
        {
          serviceId: 'svc_old',
          offeringId: 'off_old',
          sortOrder: 0,
        },
      ],
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: true,
    })

    expect(mocks.txProfessionalServiceOfferingFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.buildNormalizedBookingItemsFromRequestedOfferings).toHaveBeenCalledTimes(1)
    expect(mocks.computeBookingItemLikeTotals).toHaveBeenCalledTimes(1)

    expect(mocks.syncBookingAppointmentReminders).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()

    expect(result).toMatchObject({
      booking: {
        id: 'booking_1',
        scheduledFor: EXISTING_START.toISOString(),
        endsAt: EXPECTED_END.toISOString(),
        bufferMinutes: 15,
        durationMinutes: 90,
        totalDurationMinutes: 90,
        status: BookingStatus.ACCEPTED,
        subtotalSnapshot: '100.00',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'LOCATION',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        locationAddressSnapshot: null,
        locationLatSnapshot: null,
        locationLngSnapshot: null,
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })
})