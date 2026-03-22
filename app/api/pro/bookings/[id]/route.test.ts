import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, ServiceLocationType } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),

  updateProBooking: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickBool: mocks.pickBool,
  pickInt: mocks.pickInt,
  pickIsoDate: mocks.pickIsoDate,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  updateProBooking: mocks.updateProBooking,
}))

import { PATCH } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/bookings/booking_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('PATCH /api/pro/bookings/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      proId: 'pro_123',
      user: {
        id: 'user_123',
      },
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

    mocks.pickIsoDate.mockImplementation((value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return null
      const d = new Date(value)
      return Number.isFinite(d.getTime()) ? d : null
    })

    mocks.updateProBooking.mockResolvedValue({
      booking: {
        id: 'booking_1',
        scheduledFor: '2026-03-17T13:00:00.000Z',
        endsAt: '2026-03-17T14:15:00.000Z',
        bufferMinutes: 15,
        durationMinutes: 60,
        totalDurationMinutes: 60,
        status: BookingStatus.ACCEPTED,
        subtotalSnapshot: '50.00',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
        locationId: 'loc_1',
        locationType: ServiceLocationType.SALON,
        locationAddressSnapshot: null,
        locationLatSnapshot: null,
        locationLngSnapshot: null,
      },
      meta: {
        mutated: false,
        noOp: true,
      },
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await PATCH(makeRequest({}), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
  })

  it('returns BOOKING_ID_REQUIRED when route param id is missing', async () => {
    const result = await PATCH(makeRequest({}), {
      params: Promise.resolve({ id: '' }),
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'BOOKING_ID_REQUIRED',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'BOOKING_ID_REQUIRED',
      }),
    )
  })

  it('returns INVALID_STATUS for unsupported status', async () => {
    const result = await PATCH(
      makeRequest({
        status: 'NOPE',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Invalid status. Use ACCEPTED or CANCELLED.',
      expect.objectContaining({
        code: 'INVALID_STATUS',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_STATUS',
      }),
    )
  })

  it('returns INVALID_BOOLEAN when notifyClient is not boolean', async () => {
    const result = await PATCH(
      makeRequest({
        notifyClient: 'yes',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'notifyClient must be boolean.',
      expect.objectContaining({
        code: 'INVALID_BOOLEAN',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
  })

  it('returns INVALID_BOOLEAN when override booleans are not boolean', async () => {
    const result = await PATCH(
      makeRequest({
        allowShortNotice: 'true',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'allowShortNotice must be boolean.',
      expect.objectContaining({
        code: 'INVALID_BOOLEAN',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
  })

  it('returns INVALID_SCHEDULED_FOR when scheduledFor is invalid', async () => {
    const result = await PATCH(
      makeRequest({
        scheduledFor: 'not-a-date',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'INVALID_SCHEDULED_FOR',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
  })

  it('returns INVALID_BUFFER_MINUTES when bufferMinutes is invalid', async () => {
    const result = await PATCH(
      makeRequest({
        bufferMinutes: 'abc',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'INVALID_BUFFER_MINUTES',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
  })

  it('returns INVALID_DURATION_MINUTES when duration is invalid', async () => {
    const result = await PATCH(
      makeRequest({
        durationMinutes: 'abc',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'INVALID_DURATION_MINUTES',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
  })

  it('passes missing overrideReason through to updateProBooking and maps FORBIDDEN from the boundary', async () => {
    mocks.updateProBooking.mockRejectedValueOnce(
      bookingError('FORBIDDEN', {
        message: 'Override reason is required when using booking rule overrides.',
        userMessage: 'Please add a reason for this override.',
      }),
    )

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-17T13:30:00.000Z',
        allowShortNotice: true,
      }),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: null,
      bookingId: 'booking_1',
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: true,
      allowFarFuture: false,
      nextStart: new Date('2026-03-17T13:30:00.000Z'),
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'Please add a reason for this override.',
      expect.objectContaining({
        code: 'FORBIDDEN',
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
      }),
    )
  })

  it('returns FORBIDDEN when overrideReason is present but not text', async () => {
    const result = await PATCH(
      makeRequest({
        overrideReason: 123,
      }),
      makeCtx(),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'Override reason must be text.',
      expect.objectContaining({
        code: 'FORBIDDEN',
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
      }),
    )
  })

    it('maps override permission denial from the boundary on PATCH', async () => {
    mocks.updateProBooking.mockRejectedValueOnce(
      bookingError('FORBIDDEN', {
        message:
          'Booking override permission denied. actorUserId=user_123 professionalId=pro_123 rule=ADVANCE_NOTICE role=PRO',
        userMessage: 'You are not allowed to use that override.',
      }),
    )

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-17T13:30:00.000Z',
        allowShortNotice: true,
        overrideReason: 'Approved operational exception',
      }),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: 'Approved operational exception',
      bookingId: 'booking_1',
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: true,
      allowFarFuture: false,
      nextStart: new Date('2026-03-17T13:30:00.000Z'),
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      403,
      'You are not allowed to use that override.',
      expect.objectContaining({
        code: 'FORBIDDEN',
        message:
          'Booking override permission denied. actorUserId=user_123 professionalId=pro_123 rule=ADVANCE_NOTICE role=PRO',
      }),
    )

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
      }),
    )
  })

  it('returns stable success shape for no-op PATCH', async () => {
    const result = await PATCH(makeRequest({ notifyClient: true }), makeCtx())

    expect(mocks.updateProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: null,
      bookingId: 'booking_1',
      nextStatus: null,
      notifyClient: true,
      allowOutsideWorkingHours: false,
      allowShortNotice: false,
      allowFarFuture: false,
      nextStart: null,
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-17T13:00:00.000Z',
          endsAt: '2026-03-17T14:15:00.000Z',
          bufferMinutes: 15,
          durationMinutes: 60,
          totalDurationMinutes: 60,
          status: BookingStatus.ACCEPTED,
          subtotalSnapshot: '50.00',
          timeZone: 'America/Los_Angeles',
          timeZoneSource: 'BOOKING_SNAPSHOT',
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          locationAddressSnapshot: null,
          locationLatSnapshot: null,
          locationLngSnapshot: null,
        },
        meta: {
          mutated: false,
          noOp: true,
        },
      },
      200,
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-17T13:00:00.000Z',
          endsAt: '2026-03-17T14:15:00.000Z',
          bufferMinutes: 15,
          durationMinutes: 60,
          totalDurationMinutes: 60,
          status: BookingStatus.ACCEPTED,
          subtotalSnapshot: '50.00',
          timeZone: 'America/Los_Angeles',
          timeZoneSource: 'BOOKING_SNAPSHOT',
          locationId: 'loc_1',
          locationType: ServiceLocationType.SALON,
          locationAddressSnapshot: null,
          locationLatSnapshot: null,
          locationLngSnapshot: null,
        },
        meta: {
          mutated: false,
          noOp: true,
        },
      },
    })
  })

    it('updates a booking successfully when an authorized override is used', async () => {
    mocks.updateProBooking.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        scheduledFor: '2026-03-17T13:30:00.000Z',
        endsAt: '2026-03-17T14:45:00.000Z',
        bufferMinutes: 15,
        durationMinutes: 60,
        totalDurationMinutes: 60,
        status: BookingStatus.ACCEPTED,
        subtotalSnapshot: '50.00',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
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

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-17T13:30:00.000Z',
        allowShortNotice: true,
        overrideReason: 'Approved operational exception',
      }),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: 'Approved operational exception',
      bookingId: 'booking_1',
      nextStatus: null,
      notifyClient: false,
      allowOutsideWorkingHours: false,
      allowShortNotice: true,
      allowFarFuture: false,
      nextStart: new Date('2026-03-17T13:30:00.000Z'),
      nextBuffer: null,
      nextDuration: null,
      parsedRequestedItems: null,
      hasBuffer: false,
      hasDuration: false,
      hasServiceItems: false,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-17T13:30:00.000Z',
          endsAt: '2026-03-17T14:45:00.000Z',
          bufferMinutes: 15,
          durationMinutes: 60,
          totalDurationMinutes: 60,
          status: BookingStatus.ACCEPTED,
          subtotalSnapshot: '50.00',
          timeZone: 'America/Los_Angeles',
          timeZoneSource: 'BOOKING_SNAPSHOT',
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
      },
      200,
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-17T13:30:00.000Z',
          endsAt: '2026-03-17T14:45:00.000Z',
          bufferMinutes: 15,
          durationMinutes: 60,
          totalDurationMinutes: 60,
          status: BookingStatus.ACCEPTED,
          subtotalSnapshot: '50.00',
          timeZone: 'America/Los_Angeles',
          timeZoneSource: 'BOOKING_SNAPSHOT',
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
      },
    })
  })

  it('calls updateProBooking with parsed payload', async () => {
    mocks.updateProBooking.mockResolvedValueOnce({
      booking: {
        id: 'booking_1',
        scheduledFor: '2026-03-17T13:30:00.000Z',
        endsAt: '2026-03-17T14:45:00.000Z',
        bufferMinutes: 15,
        durationMinutes: 60,
        totalDurationMinutes: 60,
        status: BookingStatus.ACCEPTED,
        subtotalSnapshot: '50.00',
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
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

    const result = await PATCH(
      makeRequest({
        status: 'ACCEPTED',
        notifyClient: true,
        allowOutsideWorkingHours: true,
        allowShortNotice: false,
        allowFarFuture: true,
        overrideReason: '  approved by manager  ',
        scheduledFor: '2026-03-17T13:30:00.000Z',
        bufferMinutes: '15',
        durationMinutes: '60',
      }),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      actorUserId: 'user_123',
      overrideReason: 'approved by manager',
      bookingId: 'booking_1',
      nextStatus: BookingStatus.ACCEPTED,
      notifyClient: true,
      allowOutsideWorkingHours: true,
      allowShortNotice: false,
      allowFarFuture: true,
      nextStart: new Date('2026-03-17T13:30:00.000Z'),
      nextBuffer: 15,
      nextDuration: 60,
      parsedRequestedItems: null,
      hasBuffer: true,
      hasDuration: true,
      hasServiceItems: false,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        booking: {
          id: 'booking_1',
          scheduledFor: '2026-03-17T13:30:00.000Z',
          endsAt: '2026-03-17T14:45:00.000Z',
          bufferMinutes: 15,
          durationMinutes: 60,
          totalDurationMinutes: 60,
          status: BookingStatus.ACCEPTED,
          subtotalSnapshot: '50.00',
          timeZone: 'America/Los_Angeles',
          timeZoneSource: 'BOOKING_SNAPSHOT',
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
      },
    })
  })

  it('parses serviceItems and forwards them to updateProBooking', async () => {
    await PATCH(
      makeRequest({
        serviceItems: [
          {
            serviceId: 'service_2',
            offeringId: 'offering_2',
            sortOrder: 2,
          },
          {
            serviceId: 'service_1',
            offeringId: 'offering_1',
            sortOrder: 0,
          },
        ],
      }),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        parsedRequestedItems: [
          {
            serviceId: 'service_1',
            offeringId: 'offering_1',
            sortOrder: 0,
          },
          {
            serviceId: 'service_2',
            offeringId: 'offering_2',
            sortOrder: 2,
          },
        ],
        hasServiceItems: true,
      }),
    )
  })

  it('returns INVALID_SERVICE_ITEMS for malformed serviceItems', async () => {
    const result = await PATCH(
      makeRequest({
        serviceItems: [{}],
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      expect.any(String),
      expect.objectContaining({
        code: 'INVALID_SERVICE_ITEMS',
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_SERVICE_ITEMS',
      }),
    )
  })

  it('maps booking errors to jsonFail', async () => {
    mocks.updateProBooking.mockRejectedValueOnce(
      bookingError('TIME_BLOCKED', {
        message: 'Requested time is blocked.',
        userMessage: 'That time is blocked on your calendar.',
      }),
    )

    const result = await PATCH(
      makeRequest({
        scheduledFor: '2026-03-17T16:30:00.000Z',
      }),
      makeCtx(),
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