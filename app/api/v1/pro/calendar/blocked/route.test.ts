// app/api/v1/pro/calendar/blocked/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  calendarBlockFindMany: vi.fn(),
  calendarBlockCreate: vi.fn(),
  professionalLocationFindFirst: vi.fn(),
  professionalLocationAggregate: vi.fn(),

  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),
  withLockedProfessionalTransaction: vi.fn(),

  bookingError: vi.fn(),
  isBookingError: vi.fn(),
  getBookingFailPayload: vi.fn(),

  bumpScheduleVersion: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarBlock: {
      findMany: mocks.calendarBlockFindMany,
    },
  },
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

vi.mock('@/lib/booking/errors', () => ({
  bookingError: mocks.bookingError,
  isBookingError: mocks.isBookingError,
  getBookingFailPayload: mocks.getBookingFailPayload,
}))

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
}))

import { POST } from './route'

type BookingConflictCode = 'TIME_BLOCKED' | 'TIME_BOOKED' | 'TIME_HELD'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/calendar/blocked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeBookingConflictPayload(
  code: BookingConflictCode,
  overrides?: { message?: string; userMessage?: string },
) {
  const defaults = {
    TIME_BLOCKED: {
      httpStatus: 409,
      userMessage: 'That time is blocked. Please choose another slot.',
      extra: {
        code: 'TIME_BLOCKED' as const,
        retryable: true,
        uiAction: 'PICK_NEW_SLOT' as const,
        message: 'Requested time is blocked.',
      },
    },
    TIME_BOOKED: {
      httpStatus: 409,
      userMessage: 'That time was just taken. Please choose another slot.',
      extra: {
        code: 'TIME_BOOKED' as const,
        retryable: true,
        uiAction: 'PICK_NEW_SLOT' as const,
        message: 'Requested time already has a booking.',
      },
    },
    TIME_HELD: {
      httpStatus: 409,
      userMessage:
        'Someone is already holding that time. Please try another slot.',
      extra: {
        code: 'TIME_HELD' as const,
        retryable: true,
        uiAction: 'PICK_NEW_SLOT' as const,
        message: 'Requested time is currently held.',
      },
    },
  }[code]

  return {
    httpStatus: defaults.httpStatus,
    userMessage: overrides?.userMessage ?? defaults.userMessage,
    extra: {
      ...defaults.extra,
      message: overrides?.message ?? defaults.extra.message,
    },
  }
}

describe('POST /api/v1/pro/calendar/blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) => ({
        ok: false,
        status,
        error,
        ...(extra ? { extra } : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.professionalLocationFindFirst.mockResolvedValue({
      bufferMinutes: 15,
    })

    // Two bookable locations, the larger buffer being 40 — the value an
    // UNSCOPED block must take (see `resolveBlockScope`).
    mocks.professionalLocationAggregate.mockResolvedValue({
      _count: { _all: 2 },
      _max: { bufferMinutes: 40 },
    })

    mocks.calendarBlockCreate.mockResolvedValue({
      id: 'block_1',
      startsAt: new Date('2026-03-11T17:00:00.000Z'),
      endsAt: new Date('2026-03-11T18:00:00.000Z'),
      note: 'Lunch',
      locationId: 'loc_1',
    })

    mocks.getTimeRangeConflict.mockResolvedValue(null)

    mocks.bookingError.mockImplementation(
      (
        code: BookingConflictCode,
        overrides?: { message?: string; userMessage?: string },
      ) => {
        const payload = makeBookingConflictPayload(code, overrides)
        const err = new Error(payload.extra.message) as Error & {
          name: string
          code: BookingConflictCode
          httpStatus: number
          retryable: boolean
          uiAction: 'PICK_NEW_SLOT'
          userMessage: string
        }

        err.name = 'BookingError'
        err.code = code
        err.httpStatus = payload.httpStatus
        err.retryable = payload.extra.retryable
        err.uiAction = payload.extra.uiAction
        err.userMessage = payload.userMessage
        return err
      },
    )

    mocks.isBookingError.mockImplementation(
      (value: unknown): value is Error & { code: string; userMessage: string } =>
        value instanceof Error &&
        (value as { name?: unknown }).name === 'BookingError' &&
        typeof (value as { code?: unknown }).code === 'string' &&
        typeof (value as { userMessage?: unknown }).userMessage === 'string',
    )

    mocks.getBookingFailPayload.mockImplementation(
      (
        code: BookingConflictCode,
        overrides?: { message?: string; userMessage?: string },
      ) => makeBookingConflictPayload(code, overrides),
    )

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        professionalId: string,
        callback: (args: {
          tx: {
            professionalLocation: {
              findFirst: typeof mocks.professionalLocationFindFirst
              aggregate: typeof mocks.professionalLocationAggregate
            }
            calendarBlock: {
              create: typeof mocks.calendarBlockCreate
            }
          }
        }) => Promise<unknown>,
      ) => {
        const tx = {
          professionalLocation: {
            findFirst: mocks.professionalLocationFindFirst,
            aggregate: mocks.professionalLocationAggregate,
          },
          calendarBlock: {
            create: mocks.calendarBlockCreate,
          },
        }

        return callback({ tx })
      },
    )
  })

  it('returns 400 with a local code when startsAt or endsAt is missing', async () => {
    const result = await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
      }),
    )

    expect(mocks.withLockedProfessionalTransaction).not.toHaveBeenCalled()
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Missing startsAt/endsAt.',
      { code: 'BLOCK_WINDOW_REQUIRED' },
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing startsAt/endsAt.',
      extra: {
        code: 'BLOCK_WINDOW_REQUIRED',
      },
    })
  })

  it('creates an UNSCOPED block when no locationId is named', async () => {
    // `CalendarBlock.locationId` is nullable and null means "blocks all
    // locations". An omitted (or explicitly null) locationId is that scope, not
    // a missing field — this used to be a guaranteed 400.
    mocks.calendarBlockCreate.mockResolvedValueOnce({
      id: 'block_global',
      startsAt: new Date('2026-03-11T17:00:00.000Z'),
      endsAt: new Date('2026-03-11T18:00:00.000Z'),
      note: null,
      locationId: null,
    })

    const result = await POST(
      makeRequest({
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    // No single location to look up; the buffer comes from the MAX across the
    // pro's bookable locations, and that query doubles as the existence guard.
    expect(mocks.professionalLocationFindFirst).not.toHaveBeenCalled()
    expect(mocks.professionalLocationAggregate).toHaveBeenCalledWith({
      where: {
        professionalId: 'pro_123',
        isBookable: true,
      },
      _count: { _all: true },
      _max: { bufferMinutes: true },
    })

    expect(mocks.getTimeRangeConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_123',
        // Null here is what makes the gate check EVERY location.
        locationId: null,
        defaultBufferMinutes: 40,
      }),
    )

    expect(mocks.calendarBlockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationId: null }),
      }),
    )

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        block: {
          id: 'block_global',
          startsAt: '2026-03-11T17:00:00.000Z',
          endsAt: '2026-03-11T18:00:00.000Z',
          note: null,
          locationId: null,
        },
      },
    })
  })

  it('refuses an EMPTY-STRING locationId rather than treating it as global', async () => {
    // Blanket-blocking every location must be deliberate (null / omitted), not
    // something a caller falls into by sending a blank string.
    const result = await POST(
      makeRequest({
        locationId: '   ',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.withLockedProfessionalTransaction).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid locationId.',
      extra: {
        code: 'INVALID_LOCATION_ID',
      },
    })
  })

  it('refuses an unscoped block from a pro with no bookable location', async () => {
    // The existence guard that replaces "this location is yours and bookable"
    // when there is no location to name.
    mocks.professionalLocationAggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _max: { bufferMinutes: null },
    })

    const result = await POST(
      makeRequest({
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
        locationId: null,
      }),
    )

    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()
    expect(mocks.calendarBlockCreate).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Add a bookable location before blocking time.',
      extra: {
        code: 'NO_BOOKABLE_LOCATION',
      },
    })
  })

  it('runs creation inside the professional schedule lock', async () => {
    await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_123',
      expect.any(Function),
    )
  })

  it('returns 404 with a local code when location is not found', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({
        locationId: 'loc_missing',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'loc_missing',
        professionalId: 'pro_123',
        isBookable: true,
      },
      select: {
        bufferMinutes: true,
      },
    })

    expect(mocks.getTimeRangeConflict).not.toHaveBeenCalled()
    expect(mocks.calendarBlockCreate).not.toHaveBeenCalled()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      404,
      'Location not found.',
      { code: 'BLOCK_LOCATION_NOT_FOUND' },
    )
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Location not found.',
      extra: {
        code: 'BLOCK_LOCATION_NOT_FOUND',
      },
    })
  })

  it('returns a booking-contract 409 and logs when the block overlaps an existing block', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BLOCKED')

    const result = await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
        note: 'Lunch',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BLOCK_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T17:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T18:00:00.000Z'),
      conflictType: 'BLOCKED',
      meta: {
        route: 'app/api/v1/pro/calendar/blocked/route.ts',
      },
    })

    expect(mocks.bookingError).toHaveBeenCalledWith('TIME_BLOCKED', {
      userMessage: 'That time overlaps an existing block.',
    })
    expect(mocks.calendarBlockCreate).not.toHaveBeenCalled()

    // Nothing was written, so nothing may be invalidated — a bump on a refused
    // create would throw away every warm availability entry for this pro on
    // input a client can trigger at will.
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time overlaps an existing block.',
      {
        code: 'TIME_BLOCKED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time is blocked.',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time overlaps an existing block.',
      extra: {
        code: 'TIME_BLOCKED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time is blocked.',
      },
    })
  })

  it('returns a booking-contract 409 and logs when the block overlaps an existing booking', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('BOOKING')

    const result = await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BLOCK_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T17:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T18:00:00.000Z'),
      conflictType: 'BOOKING',
      meta: {
        route: 'app/api/v1/pro/calendar/blocked/route.ts',
      },
    })

    expect(mocks.bookingError).toHaveBeenCalledWith('TIME_BOOKED', {
      userMessage: 'That time overlaps an existing booking.',
    })
    expect(mocks.calendarBlockCreate).not.toHaveBeenCalled()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time overlaps an existing booking.',
      {
        code: 'TIME_BOOKED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time already has a booking.',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time overlaps an existing booking.',
      extra: {
        code: 'TIME_BOOKED',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time already has a booking.',
      },
    })
  })

  it('returns a booking-contract 409 and logs when the block overlaps an active hold', async () => {
    mocks.getTimeRangeConflict.mockResolvedValueOnce('HOLD')

    const result = await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BLOCK_CREATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T17:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T18:00:00.000Z'),
      conflictType: 'HOLD',
      meta: {
        route: 'app/api/v1/pro/calendar/blocked/route.ts',
      },
    })

    expect(mocks.bookingError).toHaveBeenCalledWith('TIME_HELD', {
      userMessage: 'That time is temporarily held for booking.',
    })
    expect(mocks.calendarBlockCreate).not.toHaveBeenCalled()

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time is temporarily held for booking.',
      {
        code: 'TIME_HELD',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time is currently held.',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is temporarily held for booking.',
      extra: {
        code: 'TIME_HELD',
        retryable: true,
        uiAction: 'PICK_NEW_SLOT',
        message: 'Requested time is currently held.',
      },
    })
  })

  it('passes tx into getTimeRangeConflict and creates the block when the range is valid', async () => {
    const result = await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
        note: 'Lunch',
      }),
    )

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'loc_1',
        professionalId: 'pro_123',
        isBookable: true,
      },
      select: {
        bufferMinutes: true,
      },
    })

    expect(mocks.getTimeRangeConflict).toHaveBeenCalledTimes(1)
    expect(mocks.getTimeRangeConflict).toHaveBeenCalledWith({
      tx: expect.objectContaining({
        professionalLocation: expect.objectContaining({
          findFirst: mocks.professionalLocationFindFirst,
        }),
        calendarBlock: expect.objectContaining({
          create: mocks.calendarBlockCreate,
        }),
      }),
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T17:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T18:00:00.000Z'),
      defaultBufferMinutes: 15,
    })

    expect(mocks.calendarBlockCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_123',
        startsAt: new Date('2026-03-11T17:00:00.000Z'),
        endsAt: new Date('2026-03-11T18:00:00.000Z'),
        note: 'Lunch',
        locationId: 'loc_1',
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        note: true,
        locationId: true,
      },
    })

    expect(mocks.logBookingConflict).not.toHaveBeenCalled()

    // The block now occupies calendar time, so every cached availability
    // surface must be invalidated — otherwise /availability/day keeps offering
    // this slot until its TTL expires and the write path dead-ends the client
    // on TIME_BLOCKED (driven and confirmed pre-fix, B2).
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_123')

    expect(result).toEqual({
      ok: true,
      status: 201,
      data: {
        block: {
          id: 'block_1',
          startsAt: '2026-03-11T17:00:00.000Z',
          endsAt: '2026-03-11T18:00:00.000Z',
          note: 'Lunch',
          locationId: 'loc_1',
        },
      },
    })
  })
})