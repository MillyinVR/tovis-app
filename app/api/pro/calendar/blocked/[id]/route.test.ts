import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),

  calendarBlockFindFirst: vi.fn(),
  calendarBlockUpdate: vi.fn(),
  calendarBlockDelete: vi.fn(),
  professionalLocationFindFirst: vi.fn(),

  assertNoCalendarBlockConflict: vi.fn(),
  hasBookingConflict: vi.fn(),
  hasHoldConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    calendarBlock: {
      findFirst: mocks.calendarBlockFindFirst,
      update: mocks.calendarBlockUpdate,
      delete: mocks.calendarBlockDelete,
    },
    professionalLocation: {
      findFirst: mocks.professionalLocationFindFirst,
    },
  },
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  assertNoCalendarBlockConflict: mocks.assertNoCalendarBlockConflict,
  hasBookingConflict: mocks.hasBookingConflict,
  hasHoldConflict: mocks.hasHoldConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

vi.mock('@/lib/booking/scheduleTransaction', () => ({
  withLockedProfessionalTransaction: mocks.withLockedProfessionalTransaction,
}))

import { PATCH } from './route'

function makePatchRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/calendar/blocked/block_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx(id = 'block_1') {
  return {
    params: Promise.resolve({ id }),
  }
}

const existingBlock = {
  id: 'block_1',
  startsAt: new Date('2026-03-11T17:00:00.000Z'),
  endsAt: new Date('2026-03-11T18:00:00.000Z'),
  note: 'Lunch',
  locationId: 'loc_1',
}

const tx = {
  calendarBlock: {
    findFirst: mocks.calendarBlockFindFirst,
    update: mocks.calendarBlockUpdate,
    delete: mocks.calendarBlockDelete,
  },
  professionalLocation: {
    findFirst: mocks.professionalLocationFindFirst,
  },
}

describe('PATCH /api/pro/calendar/blocked/[id]', () => {
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

    mocks.withLockedProfessionalTransaction.mockImplementation(
      async (
        professionalId: string,
        run: (args: { tx: typeof tx }) => Promise<unknown>,
      ) => run({ tx }),
    )

    mocks.calendarBlockFindFirst.mockResolvedValue(existingBlock)

    mocks.professionalLocationFindFirst.mockResolvedValue({
      id: 'loc_1',
      bufferMinutes: 15,
    })

    mocks.assertNoCalendarBlockConflict.mockResolvedValue(undefined)
    mocks.hasBookingConflict.mockResolvedValue(false)
    mocks.hasHoldConflict.mockResolvedValue(false)

    mocks.calendarBlockUpdate.mockResolvedValue({
      id: 'block_1',
      startsAt: new Date('2026-03-11T19:00:00.000Z'),
      endsAt: new Date('2026-03-11T20:00:00.000Z'),
      note: 'Updated note',
      locationId: 'loc_1',
    })
  })

  it('returns 400 when block id is missing', async () => {
    const result = await PATCH(makePatchRequest({}), makeCtx(''))

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing block id.', {
      code: 'BLOCK_ID_REQUIRED',
    })
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing block id.',
      code: 'BLOCK_ID_REQUIRED',
    })
  })

  it('returns 404 when block is not found', async () => {
    mocks.calendarBlockFindFirst.mockResolvedValueOnce(null)

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Not found.', {
      code: 'BLOCK_NOT_FOUND',
    })
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Not found.',
      code: 'BLOCK_NOT_FOUND',
    })
  })

  it('returns 400 when startsAt is invalid', async () => {
    const result = await PATCH(
      makePatchRequest({
        startsAt: 'not-a-date',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid startsAt.', {
      code: 'INVALID_STARTS_AT',
    })
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid startsAt.',
      code: 'INVALID_STARTS_AT',
    })
  })

  it('returns 400 when endsAt is invalid', async () => {
    const result = await PATCH(
      makePatchRequest({
        endsAt: 'still-not-a-date',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Invalid endsAt.', {
      code: 'INVALID_ENDS_AT',
    })
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid endsAt.',
      code: 'INVALID_ENDS_AT',
    })
  })

  it('returns 400 when block location is missing', async () => {
    mocks.calendarBlockFindFirst.mockResolvedValueOnce({
      ...existingBlock,
      locationId: null,
    })

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'This block is missing a location and cannot be edited.',
      {
        code: 'BLOCK_LOCATION_MISSING',
      },
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'This block is missing a location and cannot be edited.',
      code: 'BLOCK_LOCATION_MISSING',
    })
  })

  it('returns 404 when the block location is no longer valid', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(null)

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Location not found.', {
      code: 'BLOCK_LOCATION_NOT_FOUND',
    })
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Location not found.',
      code: 'BLOCK_LOCATION_NOT_FOUND',
    })
  })

  it('returns 200 without updating on a no-op patch', async () => {
    const result = await PATCH(makePatchRequest({}), makeCtx())

    expect(mocks.calendarBlockUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      status: 200,
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

  it('returns TIME_BLOCKED and logs when the updated range overlaps another block', async () => {
    mocks.assertNoCalendarBlockConflict.mockRejectedValueOnce(
      new Error('BLOCK_CONFLICT:block_conflict'),
    )

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BLOCK_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T19:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:00:00.000Z'),
      conflictType: 'BLOCKED',
      blockId: 'block_1',
      meta: {
        conflictingBlockId: 'block_conflict',
        route: 'app/api/pro/calendar/blocked/[id]/route.ts',
      },
    })

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
      code: 'TIME_BLOCKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is blocked.',
    })
  })

  it('returns TIME_BOOKED and logs when the updated range overlaps a booking', async () => {
    mocks.hasBookingConflict.mockResolvedValueOnce(true)

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BLOCK_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T19:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:00:00.000Z'),
      conflictType: 'BOOKING',
      blockId: 'block_1',
      meta: {
        route: 'app/api/pro/calendar/blocked/[id]/route.ts',
      },
    })

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
      code: 'TIME_BOOKED',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time already has a booking.',
    })
  })

  it('returns TIME_HELD and logs when the updated range overlaps a hold', async () => {
    mocks.hasHoldConflict.mockResolvedValueOnce(true)

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.logBookingConflict).toHaveBeenCalledWith({
      action: 'BLOCK_UPDATE',
      professionalId: 'pro_123',
      locationId: 'loc_1',
      requestedStart: new Date('2026-03-11T19:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:00:00.000Z'),
      conflictType: 'HOLD',
      blockId: 'block_1',
      meta: {
        route: 'app/api/pro/calendar/blocked/[id]/route.ts',
      },
    })

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
      code: 'TIME_HELD',
      retryable: true,
      uiAction: 'PICK_NEW_SLOT',
      message: 'Requested time is currently held.',
    })
  })

  it('updates the block and does not log a conflict when the range is valid', async () => {
    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
        note: 'Updated note',
      }),
      makeCtx(),
    )

    expect(mocks.withLockedProfessionalTransaction).toHaveBeenCalledWith(
      'pro_123',
      expect.any(Function),
    )

    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'loc_1',
        professionalId: 'pro_123',
        isBookable: true,
      },
      select: {
        id: true,
        bufferMinutes: true,
      },
    })

    expect(mocks.assertNoCalendarBlockConflict).toHaveBeenCalled()
    expect(mocks.hasBookingConflict).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_123',
      requestedStart: new Date('2026-03-11T19:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:00:00.000Z'),
    })

    expect(mocks.hasHoldConflict).toHaveBeenCalledWith({
      tx,
      professionalId: 'pro_123',
      requestedStart: new Date('2026-03-11T19:00:00.000Z'),
      requestedEnd: new Date('2026-03-11T20:00:00.000Z'),
      defaultBufferMinutes: 15,
    })

    expect(mocks.calendarBlockUpdate).toHaveBeenCalledWith({
      where: { id: 'block_1' },
      data: {
        startsAt: new Date('2026-03-11T19:00:00.000Z'),
        endsAt: new Date('2026-03-11T20:00:00.000Z'),
        note: 'Updated note',
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

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        block: {
          id: 'block_1',
          startsAt: '2026-03-11T19:00:00.000Z',
          endsAt: '2026-03-11T20:00:00.000Z',
          note: 'Updated note',
          locationId: 'loc_1',
        },
      },
    })
  })
})