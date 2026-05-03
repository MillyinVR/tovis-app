import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')
const REQUESTED_START = new Date('2026-03-20T18:00:00.000Z')
const REQUESTED_END = new Date('2026-03-20T19:30:00.000Z')
const HOLD_EXPIRES_AT = new Date('2026-03-18T16:10:00.000Z')

const PROFESSIONAL_ID = 'pro_mobile_1'
const CLIENT_ID = 'client_mobile_1'
const OFFERING_ID = 'offering_mobile_1'
const SERVICE_ID = 'service_mobile_1'
const LOCATION_ID = 'loc_mobile_1'
const CLIENT_ADDRESS_ID = 'addr_mobile_1'
const HOLD_ID = 'hold_mobile_1'
const BOOKING_ID = 'booking_mobile_1'
const LOCATION_TIME_ZONE = 'America/Los_Angeles'

const MOBILE_BASE_LAT = 32.7157
const MOBILE_BASE_LNG = -117.1611

const MOBILE_CLIENT_IN_RADIUS_LAT = 32.73
const MOBILE_CLIENT_IN_RADIUS_LNG = -117.15

const MOBILE_CLIENT_OUT_OF_RADIUS_LAT = 34.0522
const MOBILE_CLIENT_OUT_OF_RADIUS_LNG = -118.2437

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),
  checkProReadinessWithDb: vi.fn(),

  resolveValidatedBookingContext: vi.fn(),
  evaluateHoldCreationDecision: vi.fn(),
  evaluateFinalizeDecision: vi.fn(),

  deleteExpiredHoldsForProfessional: vi.fn(),
  deleteActiveHoldsForClient: vi.fn(),
  bumpScheduleVersion: vi.fn(),

  txClientAddressFindFirst: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),
  txBookingHoldFindUnique: vi.fn(),
  txBookingHoldCreate: vi.fn(),
  txBookingHoldDelete: vi.fn(),
  txBookingCreate: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadinessWithDb: mocks.checkProReadinessWithDb,
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

vi.mock('@/lib/booking/holdCleanup', () => ({
  deleteExpiredHoldsForProfessional: mocks.deleteExpiredHoldsForProfessional,
  deleteActiveHoldsForClient: mocks.deleteActiveHoldsForClient,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
}))

vi.mock('@/lib/notifications/appointmentReminders', () => ({
  syncBookingAppointmentReminders: mocks.syncBookingAppointmentReminders,
  cancelBookingAppointmentReminders: vi.fn(),
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  upsertClientNotification: vi.fn(),
  scheduleClientNotification: vi.fn(),
  cancelScheduledClientNotificationsForBooking: vi.fn(),
}))

vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: vi.fn(),
}))

import { createHold, finalizeBookingFromHold } from './writeBoundary'

const tx = {
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
  professionalProfile: {
    findUnique: mocks.txProfessionalProfileFindUnique,
  },
  bookingHold: {
    findUnique: mocks.txBookingHoldFindUnique,
    create: mocks.txBookingHoldCreate,
    delete: mocks.txBookingHoldDelete,
  },
  booking: {
    create: mocks.txBookingCreate,
  },
}

function makeMobileOffering() {
  return {
    id: OFFERING_ID,
    professionalId: PROFESSIONAL_ID,
    serviceId: SERVICE_ID,
    offersInSalon: false,
    offersMobile: true,
    salonDurationMinutes: null,
    mobileDurationMinutes: 90,
    salonPriceStartingAt: null,
    mobilePriceStartingAt: new Prisma.Decimal('125.00'),
    professionalTimeZone: LOCATION_TIME_ZONE,
  }
}

function makeMobileClientAddress(
  overrides: {
    lat?: Prisma.Decimal | null
    lng?: Prisma.Decimal | null
  } = {},
) {
  return {
    id: CLIENT_ADDRESS_ID,
    formattedAddress: '456 Client Home, San Diego, CA 92101',
    lat:
      overrides.lat === undefined
        ? new Prisma.Decimal(String(MOBILE_CLIENT_IN_RADIUS_LAT))
        : overrides.lat,
    lng:
      overrides.lng === undefined
        ? new Prisma.Decimal(String(MOBILE_CLIENT_IN_RADIUS_LNG))
        : overrides.lng,
  }
}

function makeMobileContext(
  overrides: {
    lat?: number | null
    lng?: number | null
  } = {},
) {
  return {
    locationId: LOCATION_ID,
    timeZone: LOCATION_TIME_ZONE,
    workingHours: {
      fri: { enabled: true, start: '09:00', end: '17:00' },
    },
    stepMinutes: 15,
    advanceNoticeMinutes: 30,
    maxDaysAhead: 45,
    bufferMinutes: 15,
    formattedAddress: '123 Mobile Base, San Diego, CA 92101',
    lat: overrides.lat === undefined ? MOBILE_BASE_LAT : overrides.lat,
    lng: overrides.lng === undefined ? MOBILE_BASE_LNG : overrides.lng,
  }
}

function makeMobileHold(
  overrides: {
    clientAddressLatSnapshot?: number | null
    clientAddressLngSnapshot?: number | null
    locationLatSnapshot?: number | null
    locationLngSnapshot?: number | null
  } = {},
) {
  return {
    id: HOLD_ID,
    offeringId: OFFERING_ID,
    professionalId: PROFESSIONAL_ID,
    clientId: CLIENT_ID,
    scheduledFor: REQUESTED_START,
    expiresAt: HOLD_EXPIRES_AT,
    locationType: ServiceLocationType.MOBILE,
    locationId: LOCATION_ID,
    locationTimeZone: LOCATION_TIME_ZONE,
    locationAddressSnapshot: null,
    locationLatSnapshot:
      overrides.locationLatSnapshot === undefined
        ? MOBILE_BASE_LAT
        : overrides.locationLatSnapshot,
    locationLngSnapshot:
      overrides.locationLngSnapshot === undefined
        ? MOBILE_BASE_LNG
        : overrides.locationLngSnapshot,
    clientAddressId: CLIENT_ADDRESS_ID,
    clientAddressSnapshot: {
      formattedAddress: '456 Client Home, San Diego, CA 92101',
    },
    clientAddressLatSnapshot:
      overrides.clientAddressLatSnapshot === undefined
        ? MOBILE_CLIENT_IN_RADIUS_LAT
        : overrides.clientAddressLatSnapshot,
    clientAddressLngSnapshot:
      overrides.clientAddressLngSnapshot === undefined
        ? MOBILE_CLIENT_IN_RADIUS_LNG
        : overrides.clientAddressLngSnapshot,
  }
}

function arrangeMobileContext() {
  mocks.resolveValidatedBookingContext.mockResolvedValueOnce({
    ok: true,
    durationMinutes: 90,
    priceStartingAt: new Prisma.Decimal('125.00'),
    context: makeMobileContext(),
  })
}

function makeCreateHoldArgs() {
  return {
    clientId: CLIENT_ID,
    offering: makeMobileOffering(),
    requestedStart: REQUESTED_START,
    requestedLocationId: LOCATION_ID,
    locationType: ServiceLocationType.MOBILE,
    clientAddressId: CLIENT_ADDRESS_ID,
  }
}

function makeFinalizeArgs() {
  return {
    clientId: CLIENT_ID,
    holdId: HOLD_ID,
    openingId: null,
    addOnIds: [],
    locationType: ServiceLocationType.MOBILE,
    source: BookingSource.REQUESTED,
    initialStatus: BookingStatus.PENDING,
    rebookOfBookingId: null,
    offering: makeMobileOffering(),
    fallbackTimeZone: 'UTC',
    requestId: null,
    idempotencyKey: null,
  }
}

describe('lib/booking/writeBoundary mobile radius guards', () => {
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

    mocks.checkProReadinessWithDb.mockResolvedValue({
      ok: true,
      liveModes: ['MOBILE'],
      readyLocationIds: [LOCATION_ID],
    })

    mocks.txProfessionalProfileFindUnique.mockResolvedValue({
      mobileRadiusMiles: 15,
    })

    mocks.txClientAddressFindFirst.mockResolvedValue(makeMobileClientAddress())

    mocks.deleteExpiredHoldsForProfessional.mockResolvedValue(0)
    mocks.deleteActiveHoldsForClient.mockResolvedValue(0)

    mocks.evaluateHoldCreationDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: REQUESTED_END,
      },
    })

    mocks.evaluateFinalizeDecision.mockResolvedValue({
      ok: true,
      value: {
        requestedEnd: REQUESTED_END,
      },
    })

    mocks.txBookingHoldCreate.mockResolvedValue({
      id: HOLD_ID,
      expiresAt: HOLD_EXPIRES_AT,
      scheduledFor: REQUESTED_START,
      locationType: ServiceLocationType.MOBILE,
      locationId: LOCATION_ID,
      locationTimeZone: LOCATION_TIME_ZONE,
      clientAddressId: CLIENT_ADDRESS_ID,
      clientAddressSnapshot: {
        formattedAddress: '456 Client Home, San Diego, CA 92101',
      },
    })

    mocks.txBookingCreate.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.PENDING,
      scheduledFor: REQUESTED_START,
      professionalId: PROFESSIONAL_ID,
    })

    mocks.txBookingHoldDelete.mockResolvedValue({
      id: HOLD_ID,
    })

    mocks.bumpScheduleVersion.mockResolvedValue(undefined)
    mocks.syncBookingAppointmentReminders.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows mobile hold creation when the client address is inside the professional radius', async () => {
    arrangeMobileContext()

    const result = await createHold(makeCreateHoldArgs())

    expect(mocks.txBookingHoldCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locationType: ServiceLocationType.MOBILE,
          locationId: LOCATION_ID,
          locationLatSnapshot: MOBILE_BASE_LAT,
          locationLngSnapshot: MOBILE_BASE_LNG,
          clientAddressId: CLIENT_ADDRESS_ID,
          clientAddressLatSnapshot: MOBILE_CLIENT_IN_RADIUS_LAT,
          clientAddressLngSnapshot: MOBILE_CLIENT_IN_RADIUS_LNG,
        }),
      }),
    )

    expect(result).toEqual({
      hold: {
        id: HOLD_ID,
        expiresAt: HOLD_EXPIRES_AT,
        scheduledFor: REQUESTED_START,
        locationType: ServiceLocationType.MOBILE,
        locationId: LOCATION_ID,
        locationTimeZone: LOCATION_TIME_ZONE,
        clientAddressId: CLIENT_ADDRESS_ID,
        clientAddressSnapshot: {
          formattedAddress: '456 Client Home, San Diego, CA 92101',
        },
      },
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  it('rejects mobile hold creation when the client address is outside the professional radius', async () => {
    mocks.txClientAddressFindFirst.mockResolvedValueOnce(
      makeMobileClientAddress({
        lat: new Prisma.Decimal(String(MOBILE_CLIENT_OUT_OF_RADIUS_LAT)),
        lng: new Prisma.Decimal(String(MOBILE_CLIENT_OUT_OF_RADIUS_LNG)),
      }),
    )

    arrangeMobileContext()

    await expect(createHold(makeCreateHoldArgs())).rejects.toMatchObject({
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    })

    expect(mocks.deleteExpiredHoldsForProfessional).not.toHaveBeenCalled()
    expect(mocks.deleteActiveHoldsForClient).not.toHaveBeenCalled()
    expect(mocks.evaluateHoldCreationDecision).not.toHaveBeenCalled()
    expect(mocks.txBookingHoldCreate).not.toHaveBeenCalled()
  })

  it('rejects mobile hold creation when the client service address has no coordinates', async () => {
    mocks.txClientAddressFindFirst.mockResolvedValueOnce(
      makeMobileClientAddress({
        lat: null,
        lng: null,
      }),
    )

    arrangeMobileContext()

    await expect(createHold(makeCreateHoldArgs())).rejects.toMatchObject({
      code: 'CLIENT_SERVICE_ADDRESS_INVALID',
    })

    expect(mocks.txBookingHoldCreate).not.toHaveBeenCalled()
  })

  it('rejects mobile hold creation when the mobile base has no coordinates', async () => {
    mocks.resolveValidatedBookingContext.mockResolvedValueOnce({
      ok: true,
      durationMinutes: 90,
      priceStartingAt: new Prisma.Decimal('125.00'),
      context: makeMobileContext({
        lat: null,
        lng: null,
      }),
    })

    await expect(createHold(makeCreateHoldArgs())).rejects.toMatchObject({
      code: 'COORDINATES_REQUIRED',
    })

    expect(mocks.txBookingHoldCreate).not.toHaveBeenCalled()
  })

  it('rejects mobile hold creation when the professional mobile radius is not configured', async () => {
    mocks.txProfessionalProfileFindUnique.mockResolvedValueOnce({
      mobileRadiusMiles: null,
    })

    arrangeMobileContext()

    await expect(createHold(makeCreateHoldArgs())).rejects.toMatchObject({
      code: 'BAD_LOCATION',
    })

    expect(mocks.txBookingHoldCreate).not.toHaveBeenCalled()
  })

  it('rejects mobile finalization when a stale hold snapshot is outside the professional radius', async () => {
    mocks.txBookingHoldFindUnique.mockResolvedValueOnce(
      makeMobileHold({
        clientAddressLatSnapshot: MOBILE_CLIENT_OUT_OF_RADIUS_LAT,
        clientAddressLngSnapshot: MOBILE_CLIENT_OUT_OF_RADIUS_LNG,
      }),
    )

    arrangeMobileContext()

    await expect(finalizeBookingFromHold(makeFinalizeArgs())).rejects.toMatchObject(
      {
        code: 'CLIENT_SERVICE_ADDRESS_INVALID',
      },
    )

    expect(mocks.evaluateFinalizeDecision).not.toHaveBeenCalled()
    expect(mocks.txBookingCreate).not.toHaveBeenCalled()
    expect(mocks.txBookingHoldDelete).not.toHaveBeenCalled()
  })
})