// app/api/pro/bookings/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, Prisma, ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),

  moneyToString: vi.fn(),
  computeRequestedEndUtc: vi.fn(),

  normalizeLocationType: vi.fn(),

  createProBooking: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/pick', () => ({
  pickBool: mocks.pickBool,
  pickInt: mocks.pickInt,
}))

vi.mock('@/lib/money', () => ({
  moneyToString: mocks.moneyToString,
}))

vi.mock('@/lib/booking/slotReadiness', () => ({
  computeRequestedEndUtc: mocks.computeRequestedEndUtc,
}))

vi.mock('@/lib/booking/locationContext', () => ({
  normalizeLocationType: mocks.normalizeLocationType,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createProBooking: mocks.createProBooking,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const scheduledFor = new Date('2026-03-11T19:30:00.000Z')
const endsAt = new Date('2026-03-11T20:45:00.000Z')

describe('POST /api/pro/bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

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

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.pickBool.mockImplementation((value: unknown) =>
      typeof value === 'boolean' ? value : null,
    )

    mocks.pickInt.mockImplementation((value: unknown) => {
      if (typeof value === 'number' && Number.isInteger(value)) return value
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) ? parsed : null
      }
      return null
    })

    mocks.normalizeLocationType.mockImplementation((value: unknown) => {
      if (value === 'SALON') return ServiceLocationType.SALON
      if (value === 'MOBILE') return ServiceLocationType.MOBILE
      return null
    })

    mocks.computeRequestedEndUtc.mockReturnValue(endsAt)
    mocks.moneyToString.mockReturnValue('50.00')

    mocks.createProBooking.mockResolvedValue({
      booking: {
        id: 'booking_1',
        scheduledFor,
        totalDurationMinutes: 60,
        bufferMinutes: 15,
        status: BookingStatus.ACCEPTED,
      },
      subtotalSnapshot: new Prisma.Decimal('50.00'),
      stepMinutes: 15,
      appointmentTimeZone: 'America/Los_Angeles',
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

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest({}))

    expect(result).toBe(authRes)
    expect(mocks.createProBooking).not.toHaveBeenCalled()
  })

  it('returns CLIENT_ID_REQUIRED when clientId is missing', async () => {
    const result = await POST(
      makeRequest({
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing client.',
      expect.objectContaining({
        code: 'CLIENT_ID_REQUIRED',
      }),
    )
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'CLIENT_ID_REQUIRED',
      }),
    )
  })

  it('returns INVALID_SCHEDULED_FOR when scheduledFor is missing or invalid', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: 'not-a-date',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'INVALID_SCHEDULED_FOR',
      }),
    )
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_SCHEDULED_FOR',
      }),
    )
  })

  it('returns LOCATION_ID_REQUIRED when locationId is missing', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'LOCATION_ID_REQUIRED',
      }),
    )
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'LOCATION_ID_REQUIRED',
      }),
    )
  })

  it('returns LOCATION_TYPE_REQUIRED when locationType is missing or invalid', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'LOCATION_TYPE_REQUIRED',
      }),
    )
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'LOCATION_TYPE_REQUIRED',
      }),
    )
  })

  it('returns OFFERING_ID_REQUIRED when offeringId is missing', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'OFFERING_ID_REQUIRED',
      }),
    )
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'OFFERING_ID_REQUIRED',
      }),
    )
  })

  it('returns CLIENT_SERVICE_ADDRESS_REQUIRED for mobile bookings without clientAddressId', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'MOBILE',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
      }),
    )
    expect(mocks.createProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'CLIENT_SERVICE_ADDRESS_REQUIRED',
      }),
    )
  })

  it('calls createProBooking with the parsed request payload', async () => {
    await POST(
      makeRequest({
        clientId: 'client_1',
        clientAddressId: 'addr_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'MOBILE',
        offeringId: 'offering_1',
        internalNotes: '  bring reference photos  ',
        bufferMinutes: '20',
        totalDurationMinutes: '90',
        allowOutsideWorkingHours: true,
        allowShortNotice: false,
        allowFarFuture: true,
      }),
    )

    expect(mocks.createProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      clientId: 'client_1',
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.MOBILE,
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      clientAddressId: 'addr_1',
      internalNotes: 'bring reference photos',
      requestedBufferMinutes: 20,
      requestedTotalDurationMinutes: 90,
      allowOutsideWorkingHours: true,
      allowShortNotice: false,
      allowFarFuture: true,
    })
  })

  it('creates a booking successfully and formats the response', async () => {
    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.createProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      clientId: 'client_1',
      offeringId: 'offering_1',
      locationId: 'loc_1',
      locationType: ServiceLocationType.SALON,
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      clientAddressId: null,
      internalNotes: null,
      requestedBufferMinutes: null,
      requestedTotalDurationMinutes: null,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
    })

    expect(mocks.computeRequestedEndUtc).toHaveBeenCalledWith({
      startUtc: scheduledFor,
      durationMinutes: 60,
      bufferMinutes: 15,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
          serviceName: 'Haircut',
          subtotalSnapshot: '50.00',
          subtotalCents: 5000,
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          clientAddressId: null,
          stepMinutes: 15,
          timeZone: 'America/Los_Angeles',
        },
      },
      201,
    )

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-11T19:30:00.000Z',
          endsAt: '2026-03-11T20:45:00.000Z',
          totalDurationMinutes: 60,
          bufferMinutes: 15,
          status: BookingStatus.ACCEPTED,
          serviceName: 'Haircut',
          subtotalSnapshot: '50.00',
          subtotalCents: 5000,
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          clientAddressId: null,
          stepMinutes: 15,
          timeZone: 'America/Los_Angeles',
        },
      },
    })
  })

  it('maps booking boundary errors to jsonFail', async () => {
    const error = new Error('Requested time is blocked.') as Error & {
      name: string
      code: string
      userMessage: string
    }

    error.name = 'BookingError'
    error.code = 'TIME_BLOCKED'
    error.userMessage = 'That time is blocked on your calendar.'

    mocks.createProBooking.mockRejectedValueOnce(error)

    const result = await POST(
      makeRequest({
        clientId: 'client_1',
        scheduledFor: '2026-03-11T19:30:00.000Z',
        locationId: 'loc_1',
        locationType: 'SALON',
        offeringId: 'offering_1',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time is blocked on your calendar.',
      expect.objectContaining({
        code: 'TIME_BLOCKED',
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 409,
        code: 'TIME_BLOCKED',
      }),
    )
  })
})