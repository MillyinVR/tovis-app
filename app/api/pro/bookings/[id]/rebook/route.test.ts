import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AftercareRebookMode, BookingStatus, Role } from '@prisma/client'

const NOW = new Date('2026-04-12T18:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-04-20T18:00:00.000Z')

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickIsoDate: vi.fn(),
  pickString: vi.fn(),

  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  failIdempotency: vi.fn(),

  isRecord: vi.fn(),

  getBookingFailPayload: vi.fn(),
  isBookingError: vi.fn(),

  bookingFindFirst: vi.fn(),
  aftercareSummaryUpsert: vi.fn(),

  createRebookedBookingFromCompletedBooking: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickIsoDate: mocks.pickIsoDate,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/guards', () => ({
  isRecord: mocks.isRecord,
}))

vi.mock('@/lib/booking/errors', () => ({
  getBookingFailPayload: mocks.getBookingFailPayload,
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
    },
    aftercareSummary: {
      upsert: mocks.aftercareSummaryUpsert,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createRebookedBookingFromCompletedBooking:
    mocks.createRebookedBookingFromCompletedBooking,
}))

vi.mock('@/lib/idempotency', () => ({
  beginIdempotency: mocks.beginIdempotency,
  completeIdempotency: mocks.completeIdempotency,
  failIdempotency: mocks.failIdempotency,
}))

vi.mock('@/lib/idempotency/routeMeta', () => ({
  IDEMPOTENCY_ROUTES: {
    PRO_BOOKING_REBOOK: 'POST /api/pro/bookings/[id]/rebook',
  },
}))

import { POST } from './route'

function makeRequest(
  body: unknown,
  opts?: {
    idempotencyKey?: string | null
    requestId?: string | null
  },
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
  })

  if (opts?.idempotencyKey !== null) {
    headers.set('idempotency-key', opts?.idempotencyKey ?? 'idem_rebook_1')
  }

  if (opts?.requestId !== null) {
    headers.set('x-request-id', opts?.requestId ?? 'req_rebook_1')
  }

  return new Request('http://localhost/api/pro/bookings/booking_1/rebook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'booking_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

function makeCompletedBooking(overrides?: {
  id?: string
  status?: BookingStatus
}) {
  return {
    id: overrides?.id ?? 'booking_1',
    status: overrides?.status ?? BookingStatus.COMPLETED,
  }
}

function makeAftercareState(overrides?: {
  rebookMode?: AftercareRebookMode
  rebookWindowStart?: Date | null
  rebookWindowEnd?: Date | null
  rebookedFor?: Date | null
  sentToClientAt?: Date | null
  version?: number
}) {
  return {
    id: 'aftercare_1',
    rebookMode: overrides?.rebookMode ?? AftercareRebookMode.NONE,
    rebookWindowStart: overrides?.rebookWindowStart ?? null,
    rebookWindowEnd: overrides?.rebookWindowEnd ?? null,
    rebookedFor: overrides?.rebookedFor ?? null,
    sentToClientAt: overrides?.sentToClientAt ?? null,
    version: overrides?.version ?? 1,
  }
}

describe('POST /api/pro/bookings/[id]/rebook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      userId: 'user_1',
      user: { id: 'user_1' },
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        ...(extra ?? {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.pickIsoDate.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    })

    mocks.beginIdempotency.mockResolvedValue({
      kind: 'started',
      idempotencyRecordId: 'idem_record_1',
      requestHash: 'hash_1',
    })

    mocks.completeIdempotency.mockResolvedValue(undefined)
    mocks.failIdempotency.mockResolvedValue(undefined)

    mocks.isRecord.mockImplementation(
      (value: unknown) =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    )

    mocks.isBookingError.mockReturnValue(false)

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: string,
        overrides?: { message?: string; userMessage?: string },
      ) => ({
        httpStatus: code === 'FORBIDDEN' ? 403 : 409,
        userMessage: overrides?.userMessage ?? overrides?.message ?? code,
        extra: {
          code,
          ...(overrides?.message ? { message: overrides.message } : {}),
        },
      }),
    )

    mocks.bookingFindFirst.mockResolvedValue(makeCompletedBooking())
    mocks.aftercareSummaryUpsert.mockResolvedValue(makeAftercareState())

    mocks.createRebookedBookingFromCompletedBooking.mockResolvedValue({
      booking: {
        id: 'booking_2',
        status: BookingStatus.PENDING,
        scheduledFor: SCHEDULED_FOR,
      },
      aftercare: {
        id: 'aftercare_1',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: SCHEDULED_FOR,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(
      makeRequest({ mode: 'BOOK', scheduledFor: SCHEDULED_FOR.toISOString() }),
      makeCtx('booking_1'),
    )

    expect(result).toBe(authRes)
    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
    expect(
      mocks.createRebookedBookingFromCompletedBooking,
    ).not.toHaveBeenCalled()
  })

  it('returns 400 when booking id is missing', async () => {
    const result = await POST(makeRequest({ mode: 'CLEAR' }), makeCtx('   '))

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing booking id.')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing booking id.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
  })

  it('returns 400 when BOOK mode is missing scheduledFor before idempotency starts', async () => {
    mocks.pickIsoDate.mockReturnValueOnce(null)

    const result = await POST(
      makeRequest({
        mode: 'BOOK',
        scheduledFor: null,
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'scheduledFor is required (ISO string) for BOOK mode.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'scheduledFor is required (ISO string) for BOOK mode.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(
      mocks.createRebookedBookingFromCompletedBooking,
    ).not.toHaveBeenCalled()
  })

  it('returns 400 when RECOMMEND_WINDOW is missing dates before idempotency starts', async () => {
    mocks.pickIsoDate.mockReturnValueOnce(null).mockReturnValueOnce(null)

    const result = await POST(
      makeRequest({
        mode: 'RECOMMEND_WINDOW',
        windowStart: null,
        windowEnd: null,
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error:
        'windowStart and windowEnd are required ISO strings for RECOMMEND_WINDOW.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 when RECOMMEND_WINDOW end is not after start before idempotency starts', async () => {
    const same = new Date('2026-04-20T18:00:00.000Z')
    mocks.pickIsoDate.mockReturnValueOnce(same).mockReturnValueOnce(same)

    const result = await POST(
      makeRequest({
        mode: 'RECOMMEND_WINDOW',
        windowStart: '2026-04-20T18:00:00.000Z',
        windowEnd: '2026-04-20T18:00:00.000Z',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'windowEnd must be after windowStart.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'windowEnd must be after windowStart.',
    })

    expect(mocks.beginIdempotency).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
  })

  it('returns 400 when idempotency key is missing before mutating', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'missing_key' })

    const result = await POST(
      makeRequest({ mode: 'CLEAR' }, { idempotencyKey: null }),
      makeCtx('booking_1'),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: 'POST /api/pro/bookings/[id]/rebook',
      key: null,
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        mode: 'CLEAR',
        scheduledFor: null,
        windowStart: null,
        windowEnd: null,
      },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing idempotency key.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing idempotency key.',
    })

    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
    expect(
      mocks.createRebookedBookingFromCompletedBooking,
    ).not.toHaveBeenCalled()
  })

  it('returns 409 when idempotency key is reused with a different request', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'conflict' })

    const result = await POST(makeRequest({ mode: 'CLEAR' }), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'This idempotency key was already used with a different request.',
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'This idempotency key was already used with a different request.',
    })

    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
  })

  it('returns 409 when matching idempotent request is already in progress', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({ kind: 'in_progress' })

    const result = await POST(makeRequest({ mode: 'CLEAR' }), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'A matching request is already in progress.',
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'A matching request is already in progress.',
    })

    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
  })

  it('replays a completed idempotency response without mutating', async () => {
    mocks.beginIdempotency.mockResolvedValueOnce({
      kind: 'replay',
      responseStatus: 201,
      responseBody: {
        ok: true,
        mode: 'BOOK',
        nextBookingId: 'booking_2',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: SCHEDULED_FOR.toISOString(),
        },
      },
    })

    const result = await POST(
      makeRequest({
        mode: 'BOOK',
        scheduledFor: SCHEDULED_FOR.toISOString(),
      }),
      makeCtx(),
    )

    expect(result).toBeInstanceOf(Response)

    if (!(result instanceof Response)) {
      throw new Error('Expected replay result to be a Response.')
    }

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      mode: 'BOOK',
      nextBookingId: 'booking_2',
      aftercare: {
        id: 'aftercare_1',
        rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
        rebookedFor: SCHEDULED_FOR.toISOString(),
      },
    })

    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
    expect(
      mocks.createRebookedBookingFromCompletedBooking,
    ).not.toHaveBeenCalled()
  })

  it('returns 404 when booking is not found', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({ mode: 'CLEAR' }),
      makeCtx('booking_1'),
    )

    expect(mocks.beginIdempotency).toHaveBeenCalledWith({
      actor: {
        actorUserId: 'user_1',
        actorRole: Role.PRO,
      },
      route: 'POST /api/pro/bookings/[id]/rebook',
      key: 'idem_rebook_1',
      requestBody: {
        bookingId: 'booking_1',
        professionalId: 'pro_1',
        mode: 'CLEAR',
        scheduledFor: null,
        windowStart: null,
        windowEnd: null,
      },
    })

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'booking_1',
        professionalId: 'pro_1',
      },
      select: {
        id: true,
        status: true,
      },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Booking not found.')
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found.',
    })

    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
  })

  it('returns 409 when booking is not completed', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeCompletedBooking({ status: BookingStatus.PENDING }),
    )

    const result = await POST(
      makeRequest({ mode: 'CLEAR' }),
      makeCtx('booking_1'),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Only COMPLETED bookings can be rebooked.',
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Only COMPLETED bookings can be rebooked.',
    })

    expect(mocks.aftercareSummaryUpsert).not.toHaveBeenCalled()
    expect(
      mocks.createRebookedBookingFromCompletedBooking,
    ).not.toHaveBeenCalled()
  })

  it('clears rebook state, completes idempotency, and returns normalized aftercare payload', async () => {
    mocks.aftercareSummaryUpsert.mockResolvedValueOnce(
      makeAftercareState({
        rebookMode: AftercareRebookMode.NONE,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        rebookedFor: null,
        sentToClientAt: new Date('2026-04-12T17:00:00.000Z'),
        version: 2,
      }),
    )

    const result = await POST(
      makeRequest({ mode: 'CLEAR' }),
      makeCtx('booking_1'),
    )

    expect(mocks.aftercareSummaryUpsert).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
      create: expect.objectContaining({
        bookingId: 'booking_1',
        rebookMode: AftercareRebookMode.NONE,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        rebookedFor: null,
        publicToken: expect.any(String),
      }),
      update: {
        rebookMode: AftercareRebookMode.NONE,
        rebookWindowStart: null,
        rebookWindowEnd: null,
        rebookedFor: null,
      },
      select: expect.any(Object),
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: {
        ok: true,
        mode: 'CLEAR',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.NONE,
          rebookWindowStart: null,
          rebookWindowEnd: null,
          rebookedFor: null,
          sentToClientAt: '2026-04-12T17:00:00.000Z',
          version: 2,
          isFinalized: true,
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        mode: 'CLEAR',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.NONE,
          rebookWindowStart: null,
          rebookWindowEnd: null,
          rebookedFor: null,
          sentToClientAt: '2026-04-12T17:00:00.000Z',
          version: 2,
          isFinalized: true,
        },
      },
    })
  })

  it('stores recommended rebook window, completes idempotency, and returns normalized aftercare payload', async () => {
    const windowStart = new Date('2026-04-20T18:00:00.000Z')
    const windowEnd = new Date('2026-04-30T18:00:00.000Z')

    mocks.pickIsoDate
      .mockReturnValueOnce(windowStart)
      .mockReturnValueOnce(windowEnd)

    mocks.aftercareSummaryUpsert.mockResolvedValueOnce(
      makeAftercareState({
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: windowStart,
        rebookWindowEnd: windowEnd,
        rebookedFor: null,
        sentToClientAt: null,
        version: 3,
      }),
    )

    const result = await POST(
      makeRequest({
        mode: 'RECOMMEND_WINDOW',
        windowStart: '2026-04-20T18:00:00.000Z',
        windowEnd: '2026-04-30T18:00:00.000Z',
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.aftercareSummaryUpsert).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
      create: expect.objectContaining({
        bookingId: 'booking_1',
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: windowStart,
        rebookWindowEnd: windowEnd,
        rebookedFor: null,
        publicToken: expect.any(String),
      }),
      update: {
        rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
        rebookWindowStart: windowStart,
        rebookWindowEnd: windowEnd,
        rebookedFor: null,
      },
      select: expect.any(Object),
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 200,
      responseBody: {
        ok: true,
        mode: 'RECOMMEND_WINDOW',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: '2026-04-20T18:00:00.000Z',
          rebookWindowEnd: '2026-04-30T18:00:00.000Z',
          rebookedFor: null,
          sentToClientAt: null,
          version: 3,
          isFinalized: false,
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        mode: 'RECOMMEND_WINDOW',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.RECOMMENDED_WINDOW,
          rebookWindowStart: '2026-04-20T18:00:00.000Z',
          rebookWindowEnd: '2026-04-30T18:00:00.000Z',
          rebookedFor: null,
          sentToClientAt: null,
          version: 3,
          isFinalized: false,
        },
      },
    })
  })

  it('creates a rebooked booking in BOOK mode and completes idempotency', async () => {
    mocks.pickIsoDate.mockReturnValueOnce(SCHEDULED_FOR)

    const result = await POST(
      makeRequest({
        mode: 'BOOK',
        scheduledFor: SCHEDULED_FOR.toISOString(),
      }),
      makeCtx('booking_1'),
    )

    expect(
      mocks.createRebookedBookingFromCompletedBooking,
    ).toHaveBeenCalledWith({
      bookingId: 'booking_1',
      professionalId: 'pro_1',
      scheduledFor: SCHEDULED_FOR,
      requestId: 'req_rebook_1',
      idempotencyKey: 'idem_rebook_1',
    })

    expect(mocks.completeIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
      responseStatus: 201,
      responseBody: {
        ok: true,
        mode: 'BOOK',
        nextBookingId: 'booking_2',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: '2026-04-20T18:00:00.000Z',
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        mode: 'BOOK',
        nextBookingId: 'booking_2',
        aftercare: {
          id: 'aftercare_1',
          rebookMode: AftercareRebookMode.BOOKED_NEXT_APPOINTMENT,
          rebookedFor: '2026-04-20T18:00:00.000Z',
        },
      },
    })
  })

  it('maps BookingError through bookingJsonFail and marks idempotency failed', async () => {
    mocks.createRebookedBookingFromCompletedBooking.mockRejectedValueOnce({
      code: 'FORBIDDEN',
      message: 'Not allowed.',
      userMessage: 'Not allowed.',
    })
    mocks.isBookingError.mockReturnValueOnce(true)
    mocks.getBookingFailPayload.mockReturnValueOnce({
      httpStatus: 403,
      userMessage: 'Not allowed.',
      extra: {
        code: 'FORBIDDEN',
        message: 'Not allowed.',
      },
    })

    mocks.pickIsoDate.mockReturnValueOnce(SCHEDULED_FOR)

    const result = await POST(
      makeRequest({
        mode: 'BOOK',
        scheduledFor: SCHEDULED_FOR.toISOString(),
      }),
      makeCtx('booking_1'),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.getBookingFailPayload).toHaveBeenCalledWith('FORBIDDEN', {
      message: 'Not allowed.',
      userMessage: 'Not allowed.',
    })

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'Not allowed.',
      code: 'FORBIDDEN',
      message: 'Not allowed.',
    })
  })

  it('returns 500 for unexpected errors and marks idempotency failed', async () => {
    mocks.aftercareSummaryUpsert.mockRejectedValueOnce(new Error('boom'))

    const result = await POST(
      makeRequest({ mode: 'CLEAR' }),
      makeCtx('booking_1'),
    )

    expect(mocks.failIdempotency).toHaveBeenCalledWith({
      idempotencyRecordId: 'idem_record_1',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})