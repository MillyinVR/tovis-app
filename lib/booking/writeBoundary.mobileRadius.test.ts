import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'
import { ADDRESS_KEY_VERSION } from '@/lib/security/addressEncryption'

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

const LEGACY_PLAINTEXT_CLIENT_SNAPSHOT = {
  formattedAddress: '456 Client Home, San Diego, CA 92101',
}

const DEDICATED_CLIENT_ENCRYPTED_SNAPSHOT = {
  v: 1,
  algorithm: 'aes-256-gcm-v1',
  keyVersion: ADDRESS_KEY_VERSION,
  ciphertext: {
    v: 1,
    algorithm: 'aes-256-gcm-v1',
    keyVersion: ADDRESS_KEY_VERSION,
    nonce: 'test-nonce',
    ciphertext: 'test-ciphertext',
    authTag: 'test-auth-tag',
  },
} satisfies Prisma.InputJsonValue

const TEST_AEAD_KEYRING = JSON.stringify({
  'address-aead-v1': 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
})

type TestJsonSnapshot = Prisma.JsonValue | Prisma.InputJsonValue | null

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),
  checkProReadinessForEntryPointWithDb: vi.fn(),

  resolveValidatedBookingContext: vi.fn(),
  evaluateHoldCreationDecision: vi.fn(),
  evaluateFinalizeDecision: vi.fn(),

  deleteExpiredHoldsForProfessional: vi.fn(),
  deleteActiveHoldsForClient: vi.fn(),
  bumpScheduleVersion: vi.fn(),

  txClientAddressFindFirst: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),
  txClientProfileFindUnique: vi.fn(),
  txBookingHoldFindUnique: vi.fn(),
  txBookingHoldFindMany: vi.fn(),
  txBookingHoldCreate: vi.fn(),
  txBookingHoldDelete: vi.fn(),
  txBookingFindMany: vi.fn(),
  txBookingCreate: vi.fn(),
  txBookingServiceItemCreate: vi.fn(),
  txBookingServiceItemCreateMany: vi.fn(),

  syncBookingAppointmentReminders: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
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
  clientProfile: {
    findUnique: mocks.txClientProfileFindUnique,
  },
  bookingHold: {
    findUnique: mocks.txBookingHoldFindUnique,
    findMany: mocks.txBookingHoldFindMany,
    create: mocks.txBookingHoldCreate,
    delete: mocks.txBookingHoldDelete,
  },
  booking: {
    findMany: mocks.txBookingFindMany,
    create: mocks.txBookingCreate,
  },
  bookingServiceItem: {
    create: mocks.txBookingServiceItemCreate,
    createMany: mocks.txBookingServiceItemCreateMany,
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
    encryptedLocationAddressSnapshotJson?: TestJsonSnapshot
    encryptedClientAddressSnapshotJson?: TestJsonSnapshot
    locationLatApprox?: number | null
    locationLngApprox?: number | null
    clientAddressLatApprox?: number | null
    clientAddressLngApprox?: number | null
    addressSnapshotsEncryptedAt?: Date | null
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
    encryptedLocationAddressSnapshotJson:
      overrides.encryptedLocationAddressSnapshotJson === undefined
        ? null
        : overrides.encryptedLocationAddressSnapshotJson,
    locationLatApprox:
      overrides.locationLatApprox === undefined
        ? null
        : overrides.locationLatApprox,
    locationLngApprox:
      overrides.locationLngApprox === undefined
        ? null
        : overrides.locationLngApprox,
    clientAddressId: CLIENT_ADDRESS_ID,
    clientAddressSnapshot: LEGACY_PLAINTEXT_CLIENT_SNAPSHOT,
    clientAddressLatSnapshot:
      overrides.clientAddressLatSnapshot === undefined
        ? MOBILE_CLIENT_IN_RADIUS_LAT
        : overrides.clientAddressLatSnapshot,
    clientAddressLngSnapshot:
      overrides.clientAddressLngSnapshot === undefined
        ? MOBILE_CLIENT_IN_RADIUS_LNG
        : overrides.clientAddressLngSnapshot,
    encryptedClientAddressSnapshotJson:
      overrides.encryptedClientAddressSnapshotJson === undefined
        ? null
        : overrides.encryptedClientAddressSnapshotJson,
    clientAddressLatApprox:
      overrides.clientAddressLatApprox === undefined
        ? null
        : overrides.clientAddressLatApprox,
    clientAddressLngApprox:
      overrides.clientAddressLngApprox === undefined
        ? null
        : overrides.clientAddressLngApprox,
    addressSnapshotsEncryptedAt:
      overrides.addressSnapshotsEncryptedAt === undefined
        ? null
        : overrides.addressSnapshotsEncryptedAt,
  }
}

function arrangeMobileContext(
  overrides: {
    lat?: number | null
    lng?: number | null
  } = {},
) {
  mocks.resolveValidatedBookingContext.mockResolvedValueOnce({
    ok: true,
    durationMinutes: 90,
    priceStartingAt: new Prisma.Decimal('125.00'),
    context: makeMobileContext(overrides),
  })
}

function makeCreateHoldArgs() {
  return {
    clientId: CLIENT_ID,
    bookingEntryPoint: 'BROAD_DISCOVERY' as const,
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
    bookingEntryPoint: 'BROAD_DISCOVERY' as const,
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
    process.env.PII_AEAD_KEYS_JSON = TEST_AEAD_KEYRING
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        _professionalId: string,
        run: (ctx: { tx: typeof tx; now: Date }) => Promise<unknown>,
      ) => run({ tx, now: TEST_NOW }),
    )

    mocks.checkProReadinessForEntryPointWithDb.mockResolvedValue({
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
    mocks.txBookingHoldFindMany.mockResolvedValue([])
    mocks.txBookingFindMany.mockResolvedValue([])

    mocks.txBookingCreate.mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.PENDING,
      scheduledFor: REQUESTED_START,
      professionalId: PROFESSIONAL_ID,
    })
    mocks.txBookingServiceItemCreate.mockResolvedValue({
      id: 'base_item_mobile_1',
    })
    mocks.txBookingServiceItemCreateMany.mockResolvedValue({ count: 0 })

    mocks.txBookingHoldDelete.mockResolvedValue({
      id: HOLD_ID,
    })

    mocks.bumpScheduleVersion.mockResolvedValue(undefined)
    mocks.syncBookingAppointmentReminders.mockResolvedValue(undefined)
  })

  afterEach(() => {
    delete process.env.PII_AEAD_KEYS_JSON
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

it('populates dedicated encrypted snapshot columns on mobile hold create', async () => {
  mocks.txClientAddressFindFirst.mockResolvedValueOnce(
    makeMobileClientAddress({
      lat: new Prisma.Decimal('32.7309876'),
      lng: new Prisma.Decimal('-117.1509876'),
    }),
  )
  arrangeMobileContext({
    lat: 32.7157123,
    lng: -117.1611987,
  })

  await createHold(makeCreateHoldArgs())

  const createCall = mocks.txBookingHoldCreate.mock.calls.at(-1)?.[0]
  const encryptedClientAddressSnapshotJson =
    createCall?.data?.encryptedClientAddressSnapshotJson

  expect(createCall).toEqual(
    expect.objectContaining({
      data: expect.objectContaining({
        encryptedLocationAddressSnapshotJson: Prisma.JsonNull,
        locationLatApprox: 32.7157,
        locationLngApprox: -117.1612,
        clientAddressLatApprox: 32.731,
        clientAddressLngApprox: -117.151,
      }),
    }),
  )

  expect(encryptedClientAddressSnapshotJson).toEqual(
    expect.objectContaining({
      v: 1,
      algorithm: 'aes-256-gcm-v1',
      keyVersion: ADDRESS_KEY_VERSION,
      ciphertext: expect.objectContaining({
        v: 1,
        algorithm: 'aes-256-gcm-v1',
        keyVersion: ADDRESS_KEY_VERSION,
        nonce: expect.any(String),
        ciphertext: expect.any(String),
        authTag: expect.any(String),
      }),
    }),
  )

  const encryptedSnapshotText = JSON.stringify(encryptedClientAddressSnapshotJson)

  expect(encryptedSnapshotText).not.toContain('456 Client Home')
  expect(encryptedSnapshotText).not.toContain('San Diego')
  expect(encryptedSnapshotText).not.toContain('92101')
  expect(encryptedSnapshotText).not.toContain('32.7309876')
  expect(encryptedSnapshotText).not.toContain('-117.1509876')
})

  it('does not copy legacy plaintext hold snapshots into dedicated encrypted booking columns', async () => {
    mocks.txBookingHoldFindUnique.mockResolvedValueOnce(
      makeMobileHold({
        clientAddressLatSnapshot: 32.7309876,
        clientAddressLngSnapshot: -117.1509876,
      }),
    )
    arrangeMobileContext()

    await finalizeBookingFromHold(makeFinalizeArgs())

    expect(mocks.txBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientAddressSnapshot: LEGACY_PLAINTEXT_CLIENT_SNAPSHOT,
          encryptedClientAddressSnapshotJson: Prisma.JsonNull,
          clientAddressLatApprox: 32.731,
          clientAddressLngApprox: -117.151,
          addressSnapshotsEncryptedAt: null,
        }),
      }),
    )
  })

  it('reuses dedicated encrypted hold snapshots when present', async () => {
    const encryptedAt = new Date('2026-03-18T15:00:00.000Z')

    mocks.txBookingHoldFindUnique.mockResolvedValueOnce(
      makeMobileHold({
        encryptedClientAddressSnapshotJson: DEDICATED_CLIENT_ENCRYPTED_SNAPSHOT,
        clientAddressLatApprox: 32.731,
        clientAddressLngApprox: -117.151,
        addressSnapshotsEncryptedAt: encryptedAt,
      }),
    )
    arrangeMobileContext()

    await finalizeBookingFromHold(makeFinalizeArgs())

    const createCall = mocks.txBookingCreate.mock.calls.at(-1)?.[0]

    expect(createCall).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          encryptedClientAddressSnapshotJson: DEDICATED_CLIENT_ENCRYPTED_SNAPSHOT,
          clientAddressLatApprox: 32.731,
          clientAddressLngApprox: -117.151,
          addressSnapshotsEncryptedAt: encryptedAt,
        }),
      }),
    )
  })

  it('logs hold create internal errors without raw address payloads and with safeError shape', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error(
      'create failed for 456 Client Home, San Diego, CA 92101 with clientAddressSnapshot payload',
    )

    mocks.txBookingHoldCreate.mockRejectedValueOnce(error)
    arrangeMobileContext()

    try {
      await expect(createHold(makeCreateHoldArgs())).rejects.toBe(error)

      expect(consoleError).toHaveBeenCalledWith(
        'performLockedCreateHold internal error',
        expect.objectContaining({
          error: {
            name: 'Error',
            message: expect.any(String),
          },
          meta: expect.objectContaining({
            clientId: CLIENT_ID,
            offeringId: OFFERING_ID,
            professionalId: PROFESSIONAL_ID,
            clientAddressId: expect.any(String),
            selectedClientAddressId: expect.any(String),
          }),
        }),
      )

      const loggedPayload = JSON.stringify(consoleError.mock.calls)
      expect(loggedPayload).not.toContain('456 Client Home')
      expect(loggedPayload).not.toContain('clientAddressSnapshot')
      expect(loggedPayload).not.toContain('formattedAddress')
    } finally {
      consoleError.mockRestore()
    }
  })

})
