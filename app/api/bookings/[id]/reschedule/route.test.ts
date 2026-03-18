import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookingStatus,
  ClientAddressKind,
  Prisma,
  ServiceLocationType,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  clampInt: vi.fn(),

  assertTimeRangeAvailable: vi.fn(),

  normalizeLocationType: vi.fn(),
  resolveValidatedBookingContext: vi.fn(),

  buildAddressSnapshot: vi.fn(),
  decimalToNumber: vi.fn(),
  pickFormattedAddressFromSnapshot: vi.fn(),

  checkSlotReadiness: vi.fn(),

  withLockedClientOwnedBookingTransaction: vi.fn(),

  txBookingFindUnique: vi.fn(),
  txProfessionalServiceOfferingFindUnique: vi.fn(),
  txBookingHoldFindUnique: vi.fn(),
  txClientAddressFindFirst: vi.fn(),
  txBookingUpdate: vi.fn(),
  txBookingHoldDelete: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/pick', () => ({
  pickString: mocks.pickString,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/timeZone', () => ({
  DEFAULT_TIME_ZONE: 'UTC',
}))

vi.mock('@/lib/pick', () => ({
  clampInt: mocks.clampInt,
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  assertTimeRangeAvailable: mocks.assertTimeRangeAvailable,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
  resolveValidatedBookingContext: mocks.resolveValidatedBookingContext,
}))

vi.mock('@/lib/booking/snapshots', () => ({
  buildAddressSnapshot: mocks.buildAddressSnapshot,
  decimalToNumber: mocks.decimalToNumber,
  pickFormattedAddressFromSnapshot: mocks.pickFormattedAddressFromSnapshot,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  checkSlotReadiness: mocks.checkSlotReadiness,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedClientOwnedBookingTransaction:
    mocks.withLockedClientOwnedBookingTransaction,
}))

import { POST } from './route'

const tx = {
  booking: {
    findUnique: mocks.txBookingFindUnique,
    update: mocks.txBookingUpdate,
  },
  professionalServiceOffering: {
    findUnique: mocks.txProfessionalServiceOfferingFindUnique,
  },
  bookingHold: {
    findUnique: mocks.txBookingHoldFindUnique,
    delete: mocks.txBookingHoldDelete,
  },
  clientAddress: {
    findFirst: mocks.txClientAddressFindFirst,
  },
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/bookings/booking_1/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

const existingBooking = {
  id: 'booking_1',
  status: BookingStatus.ACCEPTED,
  clientId: 'client_1',
  professionalId: 'pro_123',
  offeringId: 'offering_1',
  startedAt: null,
  finishedAt: null,
  totalDurationMinutes: 60,
  bufferMinutes: 15,
}

const bookingOffering = {
  id: 'offering_1',
  offersInSalon: true,
  offersMobile: true,
  salonPriceStartingAt: new Prisma.Decimal('100.00'),
  salonDurationMinutes: 60,
  mobilePriceStartingAt: new Prisma.Decimal('120.00'),
  mobileDurationMinutes: 75,
  professional: {
    timeZone: 'America/Los_Angeles',
  },
}

const hold = {
  id: 'hold_1',
  clientId: 'client_1',
  professionalId: 'pro_123',
  offeringId: 'offering_1',
  scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
  expiresAt: new Date('2026-03-11T19:45:00.000Z'),
  locationType: ServiceLocationType.SALON,
  locationId: 'loc_1',
  locationTimeZone: 'America/Los_Angeles',
  locationAddressSnapshot: { formattedAddress: '123 Salon St' },
  locationLatSnapshot: 34.05,
  locationLngSnapshot: -118.25,
  clientAddressId: null,
  clientAddressSnapshot: null,
  clientAddressLatSnapshot: null,
  clientAddressLngSnapshot: null,
}

describe('POST /api/bookings/[id]/reschedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-11T19:00:00.000Z'))

    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.clampInt.mockImplementation(
      (value: unknown, min: number, max: number) => {
        const parsed = Number(value)
        const n = Number.isFinite(parsed) ? Math.trunc(parsed) : min
        return Math.max(min, Math.min(max, n))
      },
    )

    mocks.normalizeLocationType.mockImplementation((value: unknown) => {
      if (value === 'SALON') return ServiceLocationType.SALON
      if (value === 'MOBILE') return ServiceLocationType.MOBILE
      return null
    })

    mocks.resolveValidatedBookingContext.mockResolvedValue({
      ok: true,
      durationMinutes: 60,
      priceStartingAt: new Prisma.Decimal('100.00'),
      context: {
        locationId: 'loc_1',
        timeZone: 'America/Los_Angeles',
        workingHours: {
          wed: { enabled: true, start: '09:00', end: '18:00' },
        },
        stepMinutes: 15,
        advanceNoticeMinutes: 0,
        maxDaysAhead: 30,
        bufferMinutes: 15,
        formattedAddress: '123 Salon St',
        lat: 34.05,
        lng: -118.25,
      },
    })

    mocks.buildAddressSnapshot.mockImplementation((formattedAddress: string) => ({
      formattedAddress,
    }))

    mocks.decimalToNumber.mockImplementation((value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (value instanceof Prisma.Decimal) return Number(value.toString())
      return null
    })

    mocks.pickFormattedAddressFromSnapshot.mockImplementation((value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'formattedAddress' in value &&
        typeof value.formattedAddress === 'string' &&
        value.formattedAddress.trim()
      ) {
        return value.formattedAddress.trim()
      }
      return null
    })

    mocks.checkSlotReadiness.mockReturnValue({
      ok: true,
      startUtc: new Date('2026-03-11T19:30:00.000Z'),
      endUtc: new Date('2026-03-11T20:45:00.000Z'),
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    mocks.assertTimeRangeAvailable.mockResolvedValue(undefined)

    mocks.txBookingFindUnique.mockResolvedValue(existingBooking)
    mocks.txProfessionalServiceOfferingFindUnique.mockResolvedValue(bookingOffering)
    mocks.txBookingHoldFindUnique.mockResolvedValue(hold)
    mocks.txClientAddressFindFirst.mockResolvedValue({
      id: 'addr_1',
      kind: ClientAddressKind.SERVICE_ADDRESS,
    })

    mocks.txBookingUpdate.mockResolvedValue({
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      locationType: ServiceLocationType.SALON,
      bufferMinutes: 15,
      totalDurationMinutes: 60,
      locationTimeZone: 'America/Los_Angeles',
    })

    mocks.txBookingHoldDelete.mockResolvedValue({ id: 'hold_1' })

    mocks.withLockedClientOwnedBookingTransaction.mockImplementation(
      async ({
        bookingId,
        clientId,
        run,
      }: {
        bookingId: string
        clientId: string
        run: (args: { tx: typeof tx; now: Date }) => Promise<unknown>
      }) =>
        run({
          tx,
          now: new Date('2026-03-11T19:00:00.000Z'),
        }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the locked client-owned booking transaction before availability check and booking update', async () => {
    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
        locationType: 'SALON',
      }),
      makeCtx(),
    )

    expect(mocks.withLockedClientOwnedBookingTransaction).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      clientId: 'client_1',
      run: expect.any(Function),
    })

    expect(mocks.checkSlotReadiness).toHaveBeenCalled()
    expect(mocks.assertTimeRangeAvailable).toHaveBeenCalled()
    expect(mocks.txBookingUpdate).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      data: expect.objectContaining({
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        locationType: ServiceLocationType.SALON,
        bufferMinutes: 15,
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
      }),
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        locationType: true,
        bufferMinutes: true,
        totalDurationMinutes: true,
        locationTimeZone: true,
      },
    })

    expect(mocks.txBookingHoldDelete).toHaveBeenCalledWith({
      where: { id: 'hold_1' },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          status: BookingStatus.ACCEPTED,
          scheduledFor: '2026-03-11T19:30:00.000Z',
          locationType: ServiceLocationType.SALON,
          bufferMinutes: 15,
          totalDurationMinutes: 60,
          locationTimeZone: 'America/Los_Angeles',
        },
      },
    })
  })

  it('returns HOLD_EXPIRED when the hold is expired', async () => {
    mocks.txBookingHoldFindUnique.mockResolvedValueOnce({
      ...hold,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    })

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That hold expired. Please pick a new slot.',
      code: 'HOLD_EXPIRED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Hold expired.',
    })
  })

  it('returns STEP_MISMATCH when the held time is off step', async () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'STEP_MISMATCH',
      startUtc: new Date('2026-03-11T19:30:00.000Z'),
      endUtc: new Date('2026-03-11T20:45:00.000Z'),
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Start time must be on a 15-minute boundary.',
      code: 'STEP_MISMATCH',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Start time must be on a 15-minute boundary.',
    })
  })

  it('returns OUTSIDE_WORKING_HOURS when outside working hours', async () => {
    mocks.checkSlotReadiness.mockReturnValueOnce({
      ok: false,
      code: 'OUTSIDE_WORKING_HOURS',
      startUtc: new Date('2026-03-11T19:30:00.000Z'),
      endUtc: new Date('2026-03-11T20:45:00.000Z'),
      timeZone: 'America/Los_Angeles',
      stepMinutes: 15,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'That time is outside working hours.',
      code: 'OUTSIDE_WORKING_HOURS',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'That time is outside working hours.',
    })
  })

  it('returns TIME_BLOCKED when the time is blocked', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('TIME_BLOCKED'))

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is blocked. Please choose another slot.',
      code: 'TIME_BLOCKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is blocked.',
    })
  })

  it('returns TIME_BOOKED when the time is no longer available because another booking exists', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('TIME_BOOKED'))

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time was just taken. Please choose another slot.',
      code: 'TIME_BOOKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time already has a booking.',
    })
  })

  it('returns TIME_HELD when the time is currently held', async () => {
    mocks.assertTimeRangeAvailable.mockRejectedValueOnce(new Error('TIME_HELD'))

    const result = await POST(
      makeRequest({
        holdId: 'hold_1',
      }),
      makeCtx(),
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Someone is already holding that time. Please try another slot.',
      code: 'TIME_HELD',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is currently held.',
    })
  })
})