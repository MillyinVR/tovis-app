// app/api/v1/pro/bookings/[id]/route.test.ts

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, Role, ServiceLocationType } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'
import { isRecord } from '@/lib/guards'

const IDEMPOTENCY_ROUTE = 'PATCH /api/v1/pro/bookings/[id]'
const ROUTE_OPERATION = 'PATCH /api/v1/pro/bookings/[id]'

const defaultPatchResponse = {
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
}

const updatedPatchResponse = {
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
}

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickBool: vi.fn(),
  pickInt: vi.fn(),
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),

  updateProBooking: vi.fn(),

  beginRouteIdempotency: vi.fn(),
  completeRouteIdempotency: vi.fn(),
  failStartedRouteIdempotency: vi.fn(),
  isRouteIdempotencyHandled: vi.fn(),

  captureBookingException: vi.fn(),

  // GET-side collaborators (hoisted so the GET tests can set return values
  // without importing the mocked modules and fighting Prisma's generics).
  bookingFindFirst: vi.fn(),
  resolveAppointmentSchedulingContext: vi.fn(),
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

vi.mock('@/app/api/_utils/idempotency', () => ({
  beginRouteIdempotency: mocks.beginRouteIdempotency,
  completeRouteIdempotency: mocks.completeRouteIdempotency,
  failStartedRouteIdempotency: mocks.failStartedRouteIdempotency,
  isRouteIdempotencyHandled: mocks.isRouteIdempotencyHandled,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  updateProBooking: mocks.updateProBooking,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_UPDATE: 'PATCH /api/v1/pro/bookings/[id]',
  },
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
  },
}))

vi.mock('@/lib/timeZone', () => ({
  isValidIanaTimeZone: vi.fn(() => true),
  sanitizeTimeZone: vi.fn((value: string) => value),
}))

vi.mock('@/lib/booking/timeZoneTruth', () => ({
  resolveAppointmentSchedulingContext:
    mocks.resolveAppointmentSchedulingContext,
}))

vi.mock('@/lib/money', () => ({
  moneyToFixed2String: vi.fn((value: unknown) => String(value)),
}))

vi.mock('@/lib/booking/conflicts', () => ({
  addMinutes: vi.fn((date: Date, minutes: number) => {
    const next = new Date(date)
    next.setMinutes(next.getMinutes() + minutes)
    return next
  }),
  normalizeToMinute: vi.fn((date: Date) => date),
}))

vi.mock('@/lib/booking/serviceItems', () => ({
  sumDecimal: vi.fn(() => '50.00'),
}))

vi.mock('@/lib/booking/snapshots', () => ({
  decimalToNullableNumber: vi.fn(() => null),
  pickFormattedAddressFromSnapshot: vi.fn(() => null),
}))

import { GET, PATCH } from './route'

function makeRequest(
  body: unknown,
  headers?: Record<string, string>,
): Request {
  return new NextRequest('http://localhost/api/v1/pro/bookings/booking_1', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function makeIdempotentRequest(
  body: unknown,
  key = 'idem_pro_booking_update_1',
  headers?: Record<string, string>,
): Request {
  return makeRequest(body, {
    'idempotency-key': key,
    ...(headers ?? {}),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeStartedIdempotency(key = 'idem_pro_booking_update_1') {
  return {
    kind: 'started',
    idempotencyRecordId: 'idem_record_1',
    idempotencyKey: key,
    requestHash: 'hash_1',
  }
}

function mockHandledIdempotency(response: Response | Record<string, unknown>) {
  const handledResponse =
    response instanceof Response
      ? response
      : new Response(JSON.stringify(response), {
          status:
            typeof response.status === 'number' ? response.status : 200,
          headers: {
            'content-type': 'application/json',
          },
        })

  mocks.beginRouteIdempotency.mockResolvedValueOnce({
    kind: 'handled',
    response: handledResponse,
  })
  mocks.isRouteIdempotencyHandled.mockReturnValueOnce(true)

  return handledResponse
}

function expectedBaseUpdateArgs(overrides?: Record<string, unknown>) {
  return {
    professionalId: 'pro_123',
    actorUserId: 'user_123',
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
    parsedRequestedItems: null,
    hasBuffer: false,
    hasDuration: false,
    hasServiceItems: false,
    requestId: null,
    idempotencyKey: 'idem_pro_booking_update_1',
    ...(overrides ?? {}),
  }
}

function expectedBaseIdempotencyRequestBody(
  overrides?: Record<string, unknown>,
) {
  return {
    professionalId: 'pro_123',
    actorUserId: 'user_123',
    bookingId: 'booking_1',
    nextStatus: null,
    notifyClient: false,
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
    overrideReason: null,
    ...(overrides ?? {}),
  }
}

function expectRouteIdempotencyStartedWith(
  requestBody = expectedBaseIdempotencyRequestBody(),
): void {
  expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith({
    request: expect.any(Request),
    actor: {
      actorUserId: 'user_123',
      actorRole: Role.PRO,
    },
    route: IDEMPOTENCY_ROUTE,
    requestLabel: 'pro booking update',
    requestBody,
    messages: {
      missingKey: 'Missing idempotency key.',
      inProgress: 'A matching booking update is already in progress.',
      conflict:
        'This idempotency key was already used with a different request body.',
    },
  })
}

describe('PATCH /api/v1/pro/bookings/[id]', () => {
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

    mocks.beginRouteIdempotency.mockResolvedValue(
      makeStartedIdempotency(),
    )
    mocks.isRouteIdempotencyHandled.mockReturnValue(false)
    mocks.completeRouteIdempotency.mockResolvedValue(undefined)
    mocks.failStartedRouteIdempotency.mockResolvedValue(undefined)
    mocks.updateProBooking.mockResolvedValue(defaultPatchResponse)
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await PATCH(makeRequest({}), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_BOOLEAN',
      }),
    )
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_SCHEDULED_FOR',
      }),
    )
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_BUFFER_MINUTES',
      }),
    )
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_DURATION_MINUTES',
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
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

    expect(mocks.beginRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        status: 400,
        code: 'INVALID_SERVICE_ITEMS',
      }),
    )
  })

  it('returns handled missing-key idempotency response for a valid PATCH request without idempotency header', async () => {
    const handledResponse = {
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    }

    const response = mockHandledIdempotency(handledResponse)

    const result = await PATCH(
      makeRequest({
        notifyClient: true,
      }),
      makeCtx(),
    )

    expect(result).toBe(response)
    expectRouteIdempotencyStartedWith(
      expectedBaseIdempotencyRequestBody({
        notifyClient: true,
      }),
    )

    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled in-progress idempotency response without updating booking', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error: 'A matching booking update is already in progress.',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    }

    const response = mockHandledIdempotency(handledResponse)

    const result = await PATCH(
      makeIdempotentRequest({
        notifyClient: true,
      }),
      makeCtx(),
    )

    expect(result).toBe(response)
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('returns handled conflict idempotency response without updating booking', async () => {
    const handledResponse = {
      ok: false,
      status: 409,
      error:
        'This idempotency key was already used with a different request body.',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    }

    const response = mockHandledIdempotency(handledResponse)

    const result = await PATCH(
      makeIdempotentRequest({
        notifyClient: true,
      }),
      makeCtx(),
    )

    expect(result).toBe(response)
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('replays handled idempotency response without updating booking again', async () => {
    const handledResponse = {
      ok: true,
      status: 200,
      data: defaultPatchResponse,
    }

    const response = mockHandledIdempotency(handledResponse)

    const result = await PATCH(
      makeIdempotentRequest({
        notifyClient: true,
      }),
      makeCtx(),
    )

    expect(result).toBe(response)
    expect(mocks.updateProBooking).not.toHaveBeenCalled()
    expect(mocks.completeRouteIdempotency).not.toHaveBeenCalled()
  })

  it('accepts an override-flagged update without an overrideReason and passes null through', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_missing_override_reason_1'),
    )

    const result = await PATCH(
      makeIdempotentRequest(
        {
          scheduledFor: '2026-03-17T13:30:00.000Z',
          allowShortNotice: true,
        },
        'idem_missing_override_reason_1',
      ),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expectedBaseUpdateArgs({
        allowShortNotice: true,
        nextStart: new Date('2026-03-17T13:30:00.000Z'),
        idempotencyKey: 'idem_missing_override_reason_1',
      }),
    )

    expect(mocks.failStartedRouteIdempotency).not.toHaveBeenCalled()
    expect(mocks.jsonOk).toHaveBeenCalledWith(defaultPatchResponse, 200)

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: 200,
        data: defaultPatchResponse,
      }),
    )
  })

  it('maps override permission denial from the boundary on PATCH and marks idempotency failed', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_permission_denied_1'),
    )

    mocks.updateProBooking.mockRejectedValueOnce(
      bookingError('FORBIDDEN', {
        message:
          'Booking override permission denied. actorUserId=user_123 professionalId=pro_123 rule=ADVANCE_NOTICE role=PRO',
        userMessage: 'You are not allowed to use that override.',
      }),
    )

    const result = await PATCH(
      makeIdempotentRequest(
        {
          scheduledFor: '2026-03-17T13:30:00.000Z',
          allowShortNotice: true,
          overrideReason: 'Approved operational exception',
        },
        'idem_permission_denied_1',
      ),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expectedBaseUpdateArgs({
        overrideReason: 'Approved operational exception',
        allowShortNotice: true,
        nextStart: new Date('2026-03-17T13:30:00.000Z'),
        idempotencyKey: 'idem_permission_denied_1',
      }),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
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

  it('returns stable success shape for no-op PATCH and completes idempotency', async () => {
    const result = await PATCH(
      makeIdempotentRequest(
        {
          notifyClient: true,
        },
        'idem_noop_patch_1',
      ),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(
      expectedBaseIdempotencyRequestBody({
        notifyClient: true,
      }),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expectedBaseUpdateArgs({
        notifyClient: true,
      }),
    )

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: defaultPatchResponse,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(defaultPatchResponse, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: defaultPatchResponse,
    })
  })

  it('updates a booking successfully when an authorized override is used', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_authorized_override_1'),
    )

    mocks.updateProBooking.mockResolvedValueOnce(updatedPatchResponse)

    const result = await PATCH(
      makeIdempotentRequest(
        {
          scheduledFor: '2026-03-17T13:30:00.000Z',
          allowShortNotice: true,
          overrideReason: 'Approved operational exception',
        },
        'idem_authorized_override_1',
      ),
      makeCtx(),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expectedBaseUpdateArgs({
        overrideReason: 'Approved operational exception',
        allowShortNotice: true,
        nextStart: new Date('2026-03-17T13:30:00.000Z'),
        idempotencyKey: 'idem_authorized_override_1',
      }),
    )

    expect(mocks.completeRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: updatedPatchResponse,
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith(updatedPatchResponse, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: updatedPatchResponse,
    })
  })

  it('calls updateProBooking with parsed payload', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_parsed_payload_1'),
    )

    mocks.updateProBooking.mockResolvedValueOnce(updatedPatchResponse)

    const result = await PATCH(
      makeIdempotentRequest(
        {
          status: 'ACCEPTED',
          notifyClient: true,
          allowOutsideWorkingHours: true,
          allowShortNotice: false,
          allowFarFuture: true,
          overrideReason: '  approved by manager  ',
          scheduledFor: '2026-03-17T13:30:00.000Z',
          bufferMinutes: '15',
          durationMinutes: '60',
        },
        'idem_parsed_payload_1',
      ),
      makeCtx(),
    )

    expectRouteIdempotencyStartedWith(
      expectedBaseIdempotencyRequestBody({
        nextStatus: BookingStatus.ACCEPTED,
        notifyClient: true,
        allowOutsideWorkingHours: true,
        allowFarFuture: true,
        nextStart: '2026-03-17T13:30:00.000Z',
        nextBuffer: 15,
        nextDuration: 60,
        hasBuffer: true,
        hasDuration: true,
        overrideReason: 'approved by manager',
      }),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expectedBaseUpdateArgs({
        overrideReason: 'approved by manager',
        nextStatus: BookingStatus.ACCEPTED,
        notifyClient: true,
        allowOutsideWorkingHours: true,
        allowFarFuture: true,
        nextStart: new Date('2026-03-17T13:30:00.000Z'),
        nextBuffer: 15,
        nextDuration: 60,
        hasBuffer: true,
        hasDuration: true,
        idempotencyKey: 'idem_parsed_payload_1',
      }),
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: updatedPatchResponse,
    })
  })

  it('parses serviceItems and forwards them to updateProBooking', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_service_items_1'),
    )

    await PATCH(
      makeIdempotentRequest(
        {
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
        },
        'idem_service_items_1',
      ),
      makeCtx(),
    )

    const parsedRequestedItems = [
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
    ]

    expect(mocks.beginRouteIdempotency).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          parsedRequestedItems,
          hasServiceItems: true,
        }),
      }),
    )

    expect(mocks.updateProBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        parsedRequestedItems,
        hasServiceItems: true,
        idempotencyKey: 'idem_service_items_1',
      }),
    )
  })

  it('maps booking errors to jsonFail and marks idempotency failed', async () => {
    mocks.beginRouteIdempotency.mockResolvedValueOnce(
      makeStartedIdempotency('idem_time_blocked_1'),
    )

    mocks.updateProBooking.mockRejectedValueOnce(
      bookingError('TIME_BLOCKED', {
        message: 'Requested time is blocked.',
        userMessage: 'That time is blocked on your calendar.',
      }),
    )

    const result = await PATCH(
      makeIdempotentRequest(
        {
          scheduledFor: '2026-03-17T16:30:00.000Z',
        },
        'idem_time_blocked_1',
      ),
      makeCtx(),
    )

    expect(mocks.failStartedRouteIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      operation: ROUTE_OPERATION,
    })

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
// The pro booking detail GET had no coverage before the no-show gate landed on
// it. These drive the REAL `noShowProtectionEnabled()` through its env var
// rather than mocking it: the whole point of the field is that it tracks the
// flag, and a mocked flag would prove only that the mock was returned.
describe('GET /api/v1/pro/bookings/[id] — noShowFeatureEnabled gate', () => {
  const ORIGINAL_FLAG = process.env.ENABLE_NO_SHOW_PROTECTION

  function bookingRow(clientOverrides: Record<string, unknown> = {}) {
    return {
      id: 'booking_1',
      status: BookingStatus.ACCEPTED,
      scheduledFor: new Date('2026-03-17T13:00:00.000Z'),
      locationType: ServiceLocationType.SALON,
      bufferMinutes: 15,
      totalDurationMinutes: 60,
      subtotalSnapshot: '50.00',
      clientId: 'client_1',
      locationId: 'loc_1',
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: null,
      locationLatSnapshot: null,
      locationLngSnapshot: null,
      clientAddressId: null,
      sessionStep: null,
      startedAt: null,
      finishedAt: null,
      totalAmount: null,
      serviceSubtotalSnapshot: null,
      taxAmount: null,
      tipAmount: null,
      discountAmount: null,
      paymentCollectedAt: null,
      selectedPaymentMethod: null,
      checkoutStatus: 'NOT_READY',
      rebookOfBookingId: null,
      stripePaymentStatus: null,
      stripeAmountTotal: null,
      stripeCurrency: null,
      aftercareSummary: null,
      serviceItems: [],
      client: {
        firstName: 'Ada',
        lastName: 'L',
        phone: null,
        userId: 'user_client_1',
        user: { email: 'a@b.com' },
        ...clientOverrides,
      },
      professional: { timeZone: 'America/Los_Angeles' },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
      proId: 'pro_123',
      user: { id: 'user_123' },
    })

    // A real Response here, unlike the PATCH block's plain object: it keeps
    // GET's declared return type honest so the payload can be read back without
    // a cast, and it is what the real jsonOk returns anyway.
    mocks.jsonOk.mockImplementation((data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )

    mocks.pickString.mockImplementation((value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim() : null,
    )

    mocks.resolveAppointmentSchedulingContext.mockResolvedValue({
      ok: true,
      context: {
        appointmentTimeZone: 'America/Los_Angeles',
        timeZoneSource: 'BOOKING_SNAPSHOT',
      },
    })

    mocks.bookingFindFirst.mockResolvedValue(bookingRow())
  })

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.ENABLE_NO_SHOW_PROTECTION
    } else {
      process.env.ENABLE_NO_SHOW_PROTECTION = ORIGINAL_FLAG
    }
  })

  async function getPayload(): Promise<Record<string, unknown>> {
    const result = await GET(
      new NextRequest('http://localhost/api/v1/pro/bookings/booking_1'),
      makeCtx(),
    )
    const parsed: unknown = await result.json()
    if (!isRecord(parsed) || !isRecord(parsed.booking)) {
      throw new Error(`GET did not return a booking payload: ${JSON.stringify(parsed)}`)
    }
    return parsed.booking
  }

  it('reports the gate OFF when ENABLE_NO_SHOW_PROTECTION is unset (prod today)', async () => {
    delete process.env.ENABLE_NO_SHOW_PROTECTION

    expect(await getPayload()).toMatchObject({
      id: 'booking_1',
      noShowFeatureEnabled: false,
    })
  })

  it('reports the gate ON when the flag is enabled', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = '1'

    expect(await getPayload()).toMatchObject({
      id: 'booking_1',
      noShowFeatureEnabled: true,
    })
  })

  it('does not treat an arbitrary flag value as enabled', async () => {
    process.env.ENABLE_NO_SHOW_PROTECTION = 'maybe'

    expect(await getPayload()).toMatchObject({ noShowFeatureEnabled: false })
  })
  it('reports canMessage true for a claimed client', async () => {
    const payload = await getPayload()
    const client = payload.client
    if (!isRecord(client)) throw new Error('missing client')
    expect(client.canMessage).toBe(true)
  })

  it('reports canMessage false for an UNCLAIMED client', async () => {
    // A pro-created / CSV-imported profile has no user account until the client
    // claims it, and POST /messages/resolve answers 409 CLIENT_UNCLAIMED for it.
    // Without this field iOS offered a "Message client" button that failed
    // silently, because the thrown error was swallowed.
    mocks.bookingFindFirst.mockResolvedValue(bookingRow({ userId: null }))

    const payload = await getPayload()
    const client = payload.client
    if (!isRecord(client)) throw new Error('missing client')
    expect(client.canMessage).toBe(false)
    // The raw id must never reach the wire — presence is all the client needs.
    expect(client.userId).toBeUndefined()
  })
})
