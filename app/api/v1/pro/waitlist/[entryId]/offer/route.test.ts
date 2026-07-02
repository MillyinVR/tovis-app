// app/api/v1/pro/waitlist/[entryId]/offer/route.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  requirePro: vi.fn(),

  withRouteIdempotency: vi.fn(),
  bookingJsonFail: vi.fn(),
  isBookingError: vi.fn(() => false),
  createWaitlistOffer: vi.fn(),
  kickNotificationDrain: vi.fn(),
  captureBookingException: vi.fn(),
  safeError: vi.fn((error: unknown) => ({
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message : 'Unknown error',
  })),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  requirePro: mocks.requirePro,
}))

vi.mock('@/app/api/_utils/idempotency', () => ({
  withRouteIdempotency: mocks.withRouteIdempotency,
}))

vi.mock('@/app/api/_utils/bookingResponses', () => ({
  bookingJsonFail: mocks.bookingJsonFail,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  createWaitlistOffer: mocks.createWaitlistOffer,
}))

vi.mock('@/lib/booking/errors', () => ({
  isBookingError: mocks.isBookingError,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/observability/bookingEvents', () => ({
  captureBookingException: mocks.captureBookingException,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

vi.mock('@/lib/idempotency', () => ({
  IDEMPOTENCY_ROUTES: {
    PRO_WAITLIST_OFFER: 'POST /api/v1/pro/waitlist/[entryId]/offer',
  },
}))

import { POST } from './route'

type TestCtx = { params: Promise<{ entryId: string }> }

function makeCtx(entryId = 'entry_1'): TestCtx {
  return { params: Promise.resolve({ entryId }) }
}

const VALID_BODY = {
  scheduledFor: '2026-07-10T17:00:00.000Z',
  endsAt: '2026-07-10T18:00:00.000Z',
  locationId: 'loc_1',
  locationType: 'SALON',
}

function makeRequest(args?: { body?: unknown; headers?: HeadersInit }): Request {
  return new Request(
    'http://localhost/api/v1/pro/waitlist/entry_1/offer',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(args?.headers ?? {}) },
      body:
        args && Object.prototype.hasOwnProperty.call(args, 'body')
          ? JSON.stringify(args.body)
          : undefined,
    },
  )
}

describe('app/api/v1/pro/waitlist/[entryId]/offer/route.ts', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()

    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      userId: 'user_1',
    })
    mocks.isBookingError.mockReturnValue(false)

    mocks.withRouteIdempotency.mockImplementation(
      async (
        _args: unknown,
        run: () => Promise<{ status: number; body: unknown }>,
      ) => {
        const { status, body } = await run()
        return { ok: true, status, body }
      },
    )
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const result = await POST(makeRequest({ body: VALID_BODY }), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.createWaitlistOffer).not.toHaveBeenCalled()
  })

  it('rejects a non-salon location type (400)', async () => {
    const result = await POST(
      makeRequest({ body: { ...VALID_BODY, locationType: 'MOBILE' } }),
      makeCtx(),
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Only in-salon offers are supported right now.',
    )
    expect(mocks.createWaitlistOffer).not.toHaveBeenCalled()
  })

  it('rejects a missing scheduledFor (400)', async () => {
    const { scheduledFor: _omit, ...rest } = VALID_BODY
    void _omit
    const result = await POST(makeRequest({ body: rest }), makeCtx())

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      400,
      'Invalid or missing scheduledFor.',
    )
    expect(mocks.createWaitlistOffer).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid or missing scheduledFor.',
    })
  })

  it('creates the offer through the idempotency wrapper and drains notifications', async () => {
    mocks.createWaitlistOffer.mockResolvedValueOnce({
      offer: {
        id: 'offer_9',
        status: 'PENDING',
        startsAt: new Date('2026-07-10T17:00:00.000Z'),
        endsAt: new Date('2026-07-10T18:00:00.000Z'),
        locationType: 'SALON',
      },
    })

    const result = await POST(
      makeRequest({
        body: VALID_BODY,
        headers: { 'idempotency-key': 'idem_1' },
      }),
      makeCtx(),
    )

    expect(mocks.withRouteIdempotency).toHaveBeenCalledTimes(1)
    expect(mocks.createWaitlistOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        actorUserId: 'user_1',
        waitlistEntryId: 'entry_1',
        locationId: 'loc_1',
        locationType: 'SALON',
        durationMinutes: 60,
      }),
    )
    expect(mocks.kickNotificationDrain).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      ok: true,
      status: 201,
      body: {
        ok: true,
        offer: {
          id: 'offer_9',
          status: 'PENDING',
          startsAt: '2026-07-10T17:00:00.000Z',
          endsAt: '2026-07-10T18:00:00.000Z',
          locationType: 'SALON',
        },
      },
    })
  })

  it('maps a thrown bookingError to bookingJsonFail', async () => {
    const bookingErr = {
      code: 'WAITLIST_ENTRY_NOT_FOUND',
      message: 'Waitlist entry not found or not active.',
      userMessage: 'That waitlist request is no longer available.',
    }
    mocks.createWaitlistOffer.mockRejectedValueOnce(bookingErr)
    mocks.isBookingError.mockReturnValue(true)
    mocks.bookingJsonFail.mockReturnValue({ ok: false, status: 404 })

    const result = await POST(makeRequest({ body: VALID_BODY }), makeCtx())

    expect(mocks.bookingJsonFail).toHaveBeenCalledWith(
      'WAITLIST_ENTRY_NOT_FOUND',
      { message: bookingErr.message, userMessage: bookingErr.userMessage },
    )
    expect(result).toEqual({ ok: false, status: 404 })
  })

  it('returns 500 and logs a safe error on an unexpected throw', async () => {
    const thrown = new Error('db blew up')
    mocks.createWaitlistOffer.mockRejectedValueOnce(thrown)
    mocks.isBookingError.mockReturnValue(false)

    const result = await POST(makeRequest({ body: VALID_BODY }), makeCtx())

    expect(mocks.safeError).toHaveBeenCalledWith(thrown)
    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})
