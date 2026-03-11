// app/api/pro/calendar/blocked/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  calendarBlockFindMany: vi.fn(),
  calendarBlockFindFirst: vi.fn(),
  calendarBlockCreate: vi.fn(),
  professionalLocationFindFirst: vi.fn(),

  getTimeRangeConflict: vi.fn(),
  logBookingConflict: vi.fn(),
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
      findFirst: mocks.calendarBlockFindFirst,
      create: mocks.calendarBlockCreate,
    },
    professionalLocation: {
      findFirst: mocks.professionalLocationFindFirst,
    },
  },
}))

vi.mock('@/lib/booking/conflictQueries', () => ({
  getTimeRangeConflict: mocks.getTimeRangeConflict,
}))

vi.mock('@/lib/booking/conflictLogging', () => ({
  logBookingConflict: mocks.logBookingConflict,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/calendar/blocked', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/pro/calendar/blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.calendarBlockFindFirst.mockResolvedValue(null)
    mocks.calendarBlockCreate.mockResolvedValue({
      id: 'block_1',
      startsAt: new Date('2026-03-11T17:00:00.000Z'),
      endsAt: new Date('2026-03-11T18:00:00.000Z'),
      note: 'Lunch',
      locationId: 'loc_1',
    })

    mocks.professionalLocationFindFirst.mockResolvedValue({
      id: 'loc_1',
      bufferMinutes: 15,
    })

    mocks.getTimeRangeConflict.mockResolvedValue(null)
  })

  it('returns 400 when startsAt or endsAt is missing', async () => {
    const result = await POST(
      makeRequest({
        locationId: 'loc_1',
        startsAt: '2026-03-11T17:00:00.000Z',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing startsAt/endsAt.')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Missing startsAt/endsAt.',
    })
  })

  it('returns 400 when locationId is missing', async () => {
    const result = await POST(
      makeRequest({
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Blocked time requires a locationId.',
    )
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Blocked time requires a locationId.',
    })
  })

  it('returns 404 when location is not found', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(null)

    const result = await POST(
      makeRequest({
        locationId: 'loc_missing',
        startsAt: '2026-03-11T17:00:00.000Z',
        endsAt: '2026-03-11T18:00:00.000Z',
      }),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Location not found.')
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Location not found.',
    })
  })

  it('returns 409 and logs when the block overlaps an existing block', async () => {
    mocks.calendarBlockFindFirst.mockResolvedValueOnce({ id: 'block_existing' })

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
      blockId: 'block_existing',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time overlaps an existing block.',
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time overlaps an existing block.',
    })
  })

  it('returns 409 and logs when the block overlaps an existing booking', async () => {
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
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time overlaps an existing booking.',
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time overlaps an existing booking.',
    })
  })

  it('returns 409 and logs when the block overlaps an active hold', async () => {
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
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'That time is temporarily held for booking.',
    )
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'That time is temporarily held for booking.',
    })
  })

  it('creates the block and does not log a conflict when the range is valid', async () => {
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
        id: true,
        bufferMinutes: true,
      },
    })

    expect(mocks.getTimeRangeConflict).toHaveBeenCalledWith({
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