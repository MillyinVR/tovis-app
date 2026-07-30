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
  professionalLocationAggregate: vi.fn(),

  assertNoCalendarBlockConflict: vi.fn(),
  hasBookingConflict: vi.fn(),
  hasHoldConflict: vi.fn(),
  logBookingConflict: vi.fn(),

  withLockedProfessionalTransaction: vi.fn(),

  bumpScheduleVersion: vi.fn(),
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
      aggregate: mocks.professionalLocationAggregate,
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

vi.mock('@/lib/booking/cacheVersion', () => ({
  bumpScheduleVersion: mocks.bumpScheduleVersion,
}))

import { DELETE, PATCH } from './route'

function makePatchRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/calendar/blocked/block_1', {
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
    aggregate: mocks.professionalLocationAggregate,
  },
}

describe('PATCH /api/v1/pro/calendar/blocked/[id]', () => {
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
      bufferMinutes: 15,
    })

    // Two bookable locations, the larger buffer being 40 — the value an
    // UNSCOPED block takes (see `resolveBlockScope`).
    mocks.professionalLocationAggregate.mockResolvedValue({
      _count: { _all: 2 },
      _max: { bufferMinutes: 40 },
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

  it('edits a block whose location has gone away, under global semantics', async () => {
    // `onDelete: SetNull` rewrites a deleted location's blocks to
    // `locationId: null`. Refusing here is what stranded them: still occupying
    // time, still on the calendar, never movable again.
    mocks.calendarBlockFindFirst.mockResolvedValueOnce({
      ...existingBlock,
      locationId: null,
    })

    mocks.calendarBlockUpdate.mockResolvedValueOnce({
      ...existingBlock,
      startsAt: new Date('2026-03-11T19:00:00.000Z'),
      endsAt: new Date('2026-03-11T20:00:00.000Z'),
      locationId: null,
    })

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    // No single location to read a buffer from, so it comes from the MAX across
    // the pro's bookable locations.
    expect(mocks.professionalLocationFindFirst).not.toHaveBeenCalled()
    expect(mocks.professionalLocationAggregate).toHaveBeenCalledWith({
      where: { professionalId: 'pro_123', isBookable: true },
      _count: { _all: true },
      _max: { bufferMinutes: true },
    })

    // The unscoped block keeps its own conflict semantics: it clashes with
    // EVERY block of this pro's, at any location.
    expect(mocks.assertNoCalendarBlockConflict).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: null, excludeBlockId: 'block_1' }),
    )
    expect(mocks.hasHoldConflict).toHaveBeenCalledWith(
      expect.objectContaining({ defaultBufferMinutes: 40 }),
    )

    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_123')
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        block: {
          id: 'block_1',
          startsAt: '2026-03-11T19:00:00.000Z',
          endsAt: '2026-03-11T20:00:00.000Z',
          note: 'Lunch',
          locationId: null,
        },
      },
    })
  })

  it('edits a block at a location that is no longer bookable', async () => {
    // The other half of the same defect. Deleting a location that anchors
    // bookings ARCHIVES it (`isBookable: false`) rather than removing the row,
    // so the block keeps its locationId — and the old `isBookable: true` lookup
    // then 404'd every edit.
    mocks.professionalLocationFindFirst.mockResolvedValueOnce({
      bufferMinutes: 25,
    })

    const result = await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    // The edit path deliberately does NOT require `isBookable`.
    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: { id: 'loc_1', professionalId: 'pro_123' },
      select: { bufferMinutes: true },
    })

    expect(mocks.hasHoldConflict).toHaveBeenCalledWith(
      expect.objectContaining({ defaultBufferMinutes: 25 }),
    )
    expect(result).toEqual(
      expect.objectContaining({ ok: true, status: 200 }),
    )
  })

  it('does NOT touch the location when the patch does not name one', async () => {
    // The silent-widening risk: a plain time edit must leave the scope alone.
    // If an absent `locationId` read as null, every time edit would quietly turn
    // a location-scoped block into a block on every location.
    await PATCH(
      makePatchRequest({
        startsAt: '2026-03-11T19:00:00.000Z',
        endsAt: '2026-03-11T20:00:00.000Z',
      }),
      makeCtx(),
    )

    expect(mocks.calendarBlockUpdate).toHaveBeenCalledTimes(1)
    const data = mocks.calendarBlockUpdate.mock.calls[0]?.[0]?.data
    expect(data).not.toHaveProperty('locationId')

    // …and the conflict checks still run under the STORED scope.
    expect(mocks.assertNoCalendarBlockConflict).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'loc_1' }),
    )
  })

  it('re-scopes a block to another location, authorizing it like a create', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce({
      bufferMinutes: 30,
    })

    await PATCH(makePatchRequest({ locationId: 'loc_2' }), makeCtx())

    // Authorized like a create: it must be one of THIS pro's BOOKABLE locations.
    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: { id: 'loc_2', professionalId: 'pro_123', isBookable: true },
      select: { bufferMinutes: true },
    })

    // Conflicts re-checked under the NEW scope, and the new location's buffer.
    expect(mocks.assertNoCalendarBlockConflict).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'loc_2', excludeBlockId: 'block_1' }),
    )
    expect(mocks.hasHoldConflict).toHaveBeenCalledWith(
      expect.objectContaining({ defaultBufferMinutes: 30 }),
    )

    expect(mocks.calendarBlockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { locationId: 'loc_2' },
      }),
    )
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_123')
  })

  it('re-scopes a block to ALL locations on an explicit null', async () => {
    await PATCH(makePatchRequest({ locationId: null }), makeCtx())

    // No single location to authorize; the unscoped guard runs instead.
    expect(mocks.professionalLocationFindFirst).not.toHaveBeenCalled()
    expect(mocks.professionalLocationAggregate).toHaveBeenCalled()

    // Widening has to be checked against EVERY block of this pro's.
    expect(mocks.assertNoCalendarBlockConflict).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: null }),
    )
    expect(mocks.calendarBlockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { locationId: null } }),
    )
  })

  it('refuses re-scoping to a location that is not this pro’s', async () => {
    mocks.professionalLocationFindFirst.mockResolvedValueOnce(null)

    const result = await PATCH(
      makePatchRequest({ locationId: 'loc_someone_else' }),
      makeCtx(),
    )

    expect(mocks.calendarBlockUpdate).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Location not found.',
      code: 'BLOCK_LOCATION_NOT_FOUND',
    })
  })

  it('refuses a blank locationId rather than reading it as "everywhere"', async () => {
    const result = await PATCH(makePatchRequest({ locationId: '  ' }), makeCtx())

    expect(mocks.withLockedProfessionalTransaction).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid locationId.',
      code: 'INVALID_LOCATION_ID',
    })
  })

  it('treats re-scoping to the SAME location as a no-op', async () => {
    const result = await PATCH(
      makePatchRequest({ locationId: 'loc_1' }),
      makeCtx(),
    )

    expect(mocks.calendarBlockUpdate).not.toHaveBeenCalled()
    // Nothing moved, so the availability cache is still correct.
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({ ok: true, status: 200 }),
    )
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

    // A no-op patch succeeds but writes nothing, so it must NOT invalidate.
    // The body is caller-controlled: bumping on a success that changed nothing
    // would let anyone dump this pro's warm availability cache by PATCHing `{}`
    // in a loop. Occupancy did not change, so the cache is still correct.
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
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
        route: 'app/api/v1/pro/calendar/blocked/[id]/route.ts',
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

    // Refused, so nothing moved — invalidating here would dump this pro's warm
    // availability cache on input the caller controls.
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()
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
        route: 'app/api/v1/pro/calendar/blocked/[id]/route.ts',
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
        route: 'app/api/v1/pro/calendar/blocked/[id]/route.ts',
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

    // No `isBookable` term: an EDIT must not refuse a block whose location the
    // pro has since archived or made unbookable.
    expect(mocks.professionalLocationFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'loc_1',
        professionalId: 'pro_123',
      },
      select: {
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

    // A moved block frees time at one end and occupies it at the other, so the
    // cached slot grid is wrong in both directions until this bump lands.
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_123')

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

describe('DELETE /api/v1/pro/calendar/blocked/[id]', () => {
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
    mocks.calendarBlockDelete.mockResolvedValue(existingBlock)
  })

  function makeDeleteRequest(): Request {
    return new Request('http://localhost/api/v1/pro/calendar/blocked/block_1', {
      method: 'DELETE',
    })
  }

  it('deletes the block and invalidates cached availability', async () => {
    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(mocks.calendarBlockDelete).toHaveBeenCalledWith({
      where: { id: 'block_1' },
    })

    // Deleting a block RELEASES time. Without the bump those slots stay hidden
    // behind the cached grid until its TTL expires — capacity the pro has and
    // cannot sell.
    expect(mocks.bumpScheduleVersion).toHaveBeenCalledWith('pro_123')

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: { id: 'block_1' },
    })
  })

  it('does not invalidate availability when the block does not exist', async () => {
    mocks.calendarBlockFindFirst.mockResolvedValueOnce(null)

    const result = await DELETE(makeDeleteRequest(), makeCtx('missing_block'))

    expect(mocks.calendarBlockDelete).not.toHaveBeenCalled()
    expect(mocks.bumpScheduleVersion).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Not found.',
      code: 'BLOCK_NOT_FOUND',
    })
  })
})