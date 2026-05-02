import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingSource,
  BookingStatus,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const TEST_NOW = new Date('2026-03-18T16:00:00.000Z')
const REQUESTED_START = new Date('2026-03-20T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  withLockedProfessionalTransaction: vi.fn(),
  checkProReadinessWithDb: vi.fn(),
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/pro/readiness/proReadiness', () => ({
  checkProReadinessWithDb: mocks.checkProReadinessWithDb,
}))

import {
  createHold,
  finalizeBookingFromHold,
} from './writeBoundary'

const tx = {}

function makeHoldOffering() {
  return {
    id: 'offering_1',
    professionalId: 'pro_1',
    offersInSalon: true,
    offersMobile: false,
    salonDurationMinutes: 60,
    mobileDurationMinutes: null,
    salonPriceStartingAt: new Prisma.Decimal('100'),
    mobilePriceStartingAt: null,
    professionalTimeZone: 'America/Los_Angeles',
  }
}

function makeFinalizeOffering() {
  return {
    id: 'offering_1',
    professionalId: 'pro_1',
    serviceId: 'service_1',
    offersInSalon: true,
    offersMobile: false,
    salonPriceStartingAt: new Prisma.Decimal('100'),
    salonDurationMinutes: 60,
    mobilePriceStartingAt: null,
    mobileDurationMinutes: null,
    professionalTimeZone: 'America/Los_Angeles',
  }
}

describe('lib/booking/writeBoundary readiness gates', () => {
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
      liveModes: ['SALON'],
      readyLocationIds: ['loc_1'],
    })
  })

  it('blocks hold creation when the professional is not booking-ready', async () => {
    mocks.checkProReadinessWithDb.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_BOOKABLE_LOCATION'],
    })

    await expect(
      createHold({
        clientId: 'client_1',
        offering: makeHoldOffering(),
        requestedStart: REQUESTED_START,
        requestedLocationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        clientAddressId: null,
      }),
    ).rejects.toMatchObject({
      code: 'PRO_NOT_READY',
    })

    expect(mocks.checkProReadinessWithDb).toHaveBeenCalledWith({
      db: tx,
      professionalId: 'pro_1',
    })
  })

  it('blocks booking finalization when the professional is not booking-ready', async () => {
    mocks.checkProReadinessWithDb.mockResolvedValueOnce({
      ok: false,
      blockers: ['NO_BOOKABLE_LOCATION'],
    })

    await expect(
      finalizeBookingFromHold({
        clientId: 'client_1',
        holdId: 'hold_1',
        openingId: null,
        addOnIds: [],
        locationType: ServiceLocationType.SALON,
        source: BookingSource.REQUESTED,
        initialStatus: BookingStatus.PENDING,
        rebookOfBookingId: null,
        offering: makeFinalizeOffering(),
        fallbackTimeZone: 'UTC',
        requestId: null,
        idempotencyKey: null,
      }),
    ).rejects.toMatchObject({
      code: 'PRO_NOT_READY',
    })

    expect(mocks.checkProReadinessWithDb).toHaveBeenCalledWith({
      db: tx,
      professionalId: 'pro_1',
    })
  })
})