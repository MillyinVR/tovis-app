import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingOverrideAction,
  BookingOverrideRule,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')
const REQUESTED_START = new Date('2026-03-20T18:00:00.000Z')
const REQUESTED_END = new Date('2026-03-20T19:15:00.000Z')

const BOOKING_ID = 'booking_1'
const CLIENT_ID = 'client_1'
const PROFESSIONAL_ID = 'pro_1'
const LOCATION_TIME_ZONE = 'America/Los_Angeles'

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),

  buildBookingOverrideAuditRows: vi.fn(),
  assertCanUseBookingOverride: vi.fn(),
  getProCreatedBookingStatus: vi.fn(),
  evaluateProSchedulingDecision: vi.fn(),

  txClientProfileFindUnique: vi.fn(),
  txClientAddressFindFirst: vi.fn(),
  txProfessionalServiceOfferingFindFirst: vi.fn(),
  txBookingFindUnique: vi.fn(),
  txBookingCreate: vi.fn(),
  txBookingServiceItemCreate: vi.fn(),
  txBookingOverrideAuditLogCreateMany: vi.fn(),

  resolveValidatedBookingContext: vi.fn(),

  bumpScheduleVersion: vi.fn(),

  createProNotification: vi.fn(),
  upsertClientNotification: vi.fn(),
  scheduleClientNotification: vi.fn(),
  cancelScheduledClientNotificationsForBooking: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/booking/overrideAudit', () => ({
  buildBookingOverrideAuditRows: mocks.buildBookingOverrideAuditRows,
}))

vi.mock('@/lib/booking/overrideAuthorization', () => ({
  assertCanUseBookingOverride: mocks.assertCanUseBookingOverride,
}))

vi.mock('@/lib/booking/statusRules', () => ({
  getProCreatedBookingStatus: mocks.getProCreatedBookingStatus,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
}))

vi.mock('@/lib/booking/policies/proSchedulingPolicy', () => ({
  evaluateProSchedulingDecision: mocks.evaluateProSchedulingDecision,
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

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mocks.createProNotification,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: mocks.upsertClientNotification,
  scheduleClientNotification: mocks.scheduleClientNotification,
  cancelScheduledClientNotificationsForBooking:
    mocks.cancelScheduledClientNotificationsForBooking,
}))

import { createProBooking } from './writeBoundary'

const tx = {
  clientProfile: {
    findUnique: mocks.txClientProfileFindUnique,
  },
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
  professionalServiceOffering: {
    findFirst: mocks.txProfessionalServiceOfferingFindFirst,
  },
  booking: {
    findUnique: mocks.txBookingFindUnique,
    create: mocks.txBookingCreate,
  },
  bookingServiceItem: {
    create: mocks.txBookingServiceItemCreate,
  },
  bookingOverrideAuditLog: {
    createMany: mocks.txBookingOverrideAuditLogCreateMany,
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

function makeReminderSyncBooking() {
  return {
    id: BOOKING_ID,
    clientId: CLIENT_ID,
    scheduledFor: REQUESTED_START,
    status: BookingStatus.ACCEPTED,
    finishedAt: null,
    locationTimeZone: LOCATION_TIME_ZONE,
    service: {
      name: 'Haircut',
    },
  }
}

function installReminderSyncBookingFindUniqueMock() {
  const reminderSyncBooking = makeReminderSyncBooking()

  mocks.txBookingFindUnique.mockImplementation(
    async (args?: { select?: Record<string, unknown> }) => {
      const select = isRecord(args?.select) ? args.select : undefined

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

describe('lib/booking/writeBoundary override audit', () => {
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

    mocks.getProCreatedBookingStatus.mockReturnValue(BookingStatus.ACCEPTED)

    mocks.txClientProfileFindUnique.mockResolvedValue({
      id: CLIENT_ID,
    })

    mocks.txClientAddressFindFirst.mockResolvedValue(null)

    mocks.txProfessionalServiceOfferingFindFirst.mockResolvedValue({
      id: 'offering_1',
      serviceId: 'service_1',
      offersInSalon: true,
      offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal('50.00'),
      mobilePriceStartingAt: null,
      salonDurationMinutes: 60,
      mobileDurationMinutes: null,
      professional: {
        timeZone: LOCATION_TIME_ZONE,
      },
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
    })

    installReminderSyncBookingFindUniqueMock()

    mocks.resolveValidatedBookingContext.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
      priceStartingAt: new Prisma.Decimal('50.00'),
      context: {
        locationId: 'loc_1',
        timeZone: LOCATION_TIME_ZONE,
        workingHours: {
          wed: { enabled: true, start: '09:00', end: '17:00' },
        },
        stepMinutes: 15,
        advanceNoticeMinutes: 30,
        maxDaysAhead: 45,
        bufferMinutes: 15,
        formattedAddress: '123 Salon St',
        lat: 34.05,
        lng: -118.25,
      },
    })

    mocks.evaluateProSchedulingDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: REQUESTED_END,
        appliedOverrides: ['ADVANCE_NOTICE'],
      },
    })

    mocks.txBookingCreate.mockResolvedValue({
      id: BOOKING_ID,
      scheduledFor: REQUESTED_START,
      totalDurationMinutes: 60,
      bufferMinutes: 15,
      status: BookingStatus.ACCEPTED,
    })

    mocks.txBookingServiceItemCreate.mockResolvedValue({
      id: 'item_1',
    })

    mocks.txBookingOverrideAuditLogCreateMany.mockResolvedValue({
      count: 1,
    })

    mocks.assertCanUseBookingOverride.mockResolvedValue(undefined)
    mocks.bumpScheduleVersion.mockResolvedValue(undefined)

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

  it('creates audit rows when an applied override is actually used', async () => {
    mocks.buildBookingOverrideAuditRows.mockReturnValue([
      {
        bookingId: BOOKING_ID,
        professionalId: PROFESSIONAL_ID,
        actorUserId: 'user_1',
        action: BookingOverrideAction.CREATE,
        rule: BookingOverrideRule.ADVANCE_NOTICE,
        reason: 'approved by manager',
        route: 'lib/booking/writeBoundary.ts:createProBooking',
        requestId: null,
        oldValue: {
          allowShortNotice: false,
          advanceNoticeMinutes: 30,
        },
        newValue: {
          allowShortNotice: true,
          advanceNoticeMinutes: 30,
        },
        bookingScheduledForBefore: null,
        bookingScheduledForAfter: REQUESTED_START,
        metadata: {
          source: 'booking_override_audit',
          appliedOverride: 'ADVANCE_NOTICE',
          timeZone: LOCATION_TIME_ZONE,
        },
        createdAt: TEST_NOW,
      },
    ])

    const result = await createProBooking({
      professionalId: PROFESSIONAL_ID,
      actorUserId: 'user_1',
      overrideReason: 'approved by manager',
      clientId: CLIENT_ID,
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor: REQUESTED_START,
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: true,
      allowFarFuture: false,
    })

    expect(mocks.assertCanUseBookingOverride).toHaveBeenCalledWith({
      actorUserId: 'user_1',
      professionalId: PROFESSIONAL_ID,
      rule: 'ADVANCE_NOTICE',
    })

    expect(mocks.buildBookingOverrideAuditRows).toHaveBeenCalledWith({
      bookingId: BOOKING_ID,
      professionalId: PROFESSIONAL_ID,
      actorUserId: 'user_1',
      action: 'CREATE',
      route: 'lib/booking/writeBoundary.ts:createProBooking',
      reason: 'approved by manager',
      appliedOverrides: ['ADVANCE_NOTICE'],
      bookingScheduledForBefore: null,
      bookingScheduledForAfter: REQUESTED_START,
      advanceNoticeMinutes: 30,
      maxDaysAhead: 45,
      workingHours: {
        wed: { enabled: true, start: '09:00', end: '17:00' },
      },
      timeZone: LOCATION_TIME_ZONE,
    })

    expect(mocks.txBookingOverrideAuditLogCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          bookingId: BOOKING_ID,
          rule: BookingOverrideRule.ADVANCE_NOTICE,
        }),
      ],
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
        scheduledFor: REQUESTED_START,
        totalDurationMinutes: 60,
        bufferMinutes: 15,
        status: BookingStatus.ACCEPTED,
      },
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      stepMinutes: 15,
      appointmentTimeZone: LOCATION_TIME_ZONE,
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      clientAddressId: null,
      serviceName: 'Haircut',
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('does not write audit rows when no override was actually applied', async () => {
    mocks.evaluateProSchedulingDecision.mockResolvedValueOnce({
      ok: true,
      value: {
        requestedEnd: REQUESTED_END,
        appliedOverrides: [],
      },
    })

    await createProBooking({
      professionalId: PROFESSIONAL_ID,
      actorUserId: 'user_1',
      overrideReason: null,
      clientId: CLIENT_ID,
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor: REQUESTED_START,
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.assertCanUseBookingOverride).not.toHaveBeenCalled()
    expect(mocks.buildBookingOverrideAuditRows).not.toHaveBeenCalled()
    expect(mocks.txBookingOverrideAuditLogCreateMany).not.toHaveBeenCalled()

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
  })

it('rolls back when audit persistence fails', async () => {
  mocks.buildBookingOverrideAuditRows.mockReturnValue([
    {
      bookingId: BOOKING_ID,
      professionalId: PROFESSIONAL_ID,
      actorUserId: 'user_1',
      action: BookingOverrideAction.CREATE,
      rule: BookingOverrideRule.ADVANCE_NOTICE,
      reason: 'approved by manager',
      route: 'lib/booking/writeBoundary.ts:createProBooking',
      requestId: null,
      oldValue: { allowShortNotice: false, advanceNoticeMinutes: 30 },
      newValue: { allowShortNotice: true, advanceNoticeMinutes: 30 },
      bookingScheduledForBefore: null,
      bookingScheduledForAfter: REQUESTED_START,
      metadata: {
        source: 'booking_override_audit',
        appliedOverride: 'ADVANCE_NOTICE',
        timeZone: LOCATION_TIME_ZONE,
      },
      createdAt: TEST_NOW,
    },
  ])

  mocks.txBookingOverrideAuditLogCreateMany.mockRejectedValueOnce(
    new Error('audit write failed'),
  )

  await expect(
    createProBooking({
      professionalId: PROFESSIONAL_ID,
      actorUserId: 'user_1',
      overrideReason: 'approved by manager',
      clientId: CLIENT_ID,
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor: REQUESTED_START,
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: true,
      allowFarFuture: false,
    }),
  ).rejects.toThrow('audit write failed')

  expect(mocks.txBookingOverrideAuditLogCreateMany).toHaveBeenCalled()

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
})
})