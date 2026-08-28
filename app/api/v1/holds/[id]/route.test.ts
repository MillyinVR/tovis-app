import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'
import { BookingError, getBookingErrorDescriptor } from '@/lib/booking/errors'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  bookingHoldFindUnique: vi.fn(),
  releaseHold: vi.fn(),
  updateHoldAddOns: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitExceededResponse: vi.fn(),
  broadcastChange: vi.fn(),
}))

vi.mock('@/lib/rateLimit/enforce', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
}))

vi.mock('@/lib/rateLimit/identity', () => ({
  clientRateLimitKey: () => 'client_1',
}))

vi.mock('@/lib/rateLimit/response', () => ({
  rateLimitExceededResponse: mocks.rateLimitExceededResponse,
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bookingHold: {
      findUnique: mocks.bookingHoldFindUnique,
    },
  },
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  releaseHold: mocks.releaseHold,
  updateHoldAddOns: mocks.updateHoldAddOns,
}))

vi.mock('@/lib/live/broadcastAudience', () => ({
  broadcastChange: mocks.broadcastChange,
}))

import { GET, DELETE, PATCH } from './route'

function patchRequest(body: unknown): Request {
  return new Request('http://localhost', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function makeCtx(id: string): { params: Promise<{ id: string }> } {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('app/api/v1/holds/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'usr_1' },
    })

    mocks.enforceRateLimit.mockResolvedValue({ allowed: true })

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

    mocks.bookingHoldFindUnique.mockResolvedValue({
      id: 'hold_1',
      clientId: 'client_1',
      professionalId: 'pro_1',
      offeringId: 'offering_1',
      scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
      expiresAt: new Date('2099-03-11T19:45:00.000Z'),
      locationType: ServiceLocationType.SALON,
      locationId: 'loc_1',
      locationTimeZone: 'America/Los_Angeles',
      locationAddressSnapshot: { formattedAddress: '123 Salon St' },
      locationLatSnapshot: 34.05,
      locationLngSnapshot: -118.25,
    })

    mocks.releaseHold.mockResolvedValue({
      holdId: 'hold_1',
      professionalId: 'pro_1',
      meta: {
        mutated: true,
        noOp: false,
      },
    })

    mocks.updateHoldAddOns.mockResolvedValue({
      hold: {
        id: 'hold_1',
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        expiresAt: new Date('2099-03-11T19:45:00.000Z'),
        durationMinutes: 90,
        endsAt: new Date('2026-03-11T21:00:00.000Z'),
      },
      professionalId: 'pro_1',
      meta: {
        mutated: true,
        noOp: false,
      },
    })
  })

  describe('GET', () => {
    it('returns auth response when client auth fails', async () => {
      const authRes = { ok: false, status: 401, error: 'Unauthorized' }
      mocks.requireClient.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await GET(new Request('http://localhost'), makeCtx('hold_1'))

      expect(result).toBe(authRes)
      expect(mocks.bookingHoldFindUnique).not.toHaveBeenCalled()
    })

    it('returns HOLD_ID_REQUIRED when hold id is missing', async () => {
      const descriptor = getBookingErrorDescriptor('HOLD_ID_REQUIRED')

      const result = await GET(new Request('http://localhost'), makeCtx(''))

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        descriptor.httpStatus,
        descriptor.userMessage,
        {
          code: descriptor.code,
          retryable: descriptor.retryable,
          uiAction: descriptor.uiAction,
          message: descriptor.message,
        },
      )

      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('returns HOLD_NOT_FOUND when hold does not exist', async () => {
      const descriptor = getBookingErrorDescriptor('HOLD_NOT_FOUND')
      mocks.bookingHoldFindUnique.mockResolvedValueOnce(null)

      const result = await GET(
        new Request('http://localhost'),
        makeCtx('hold_404'),
      )

      expect(mocks.bookingHoldFindUnique).toHaveBeenCalledWith({
        where: { id: 'hold_404' },
        select: {
          id: true,
          clientId: true,
          professionalId: true,
          offeringId: true,
          scheduledFor: true,
          expiresAt: true,
          locationType: true,
          locationId: true,
          locationTimeZone: true,
          locationAddressSnapshot: true,
          locationLatSnapshot: true,
          locationLngSnapshot: true,
        },
      })

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        descriptor.httpStatus,
        descriptor.userMessage,
        {
          code: descriptor.code,
          retryable: descriptor.retryable,
          uiAction: descriptor.uiAction,
          message: descriptor.message,
        },
      )

      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('returns HOLD_FORBIDDEN when hold belongs to another client', async () => {
      const descriptor = getBookingErrorDescriptor('HOLD_FORBIDDEN')

      mocks.bookingHoldFindUnique.mockResolvedValueOnce({
        id: 'hold_1',
        clientId: 'client_other',
        professionalId: 'pro_1',
        offeringId: 'offering_1',
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        expiresAt: new Date('2099-03-11T19:45:00.000Z'),
        locationType: ServiceLocationType.SALON,
        locationId: 'loc_1',
        locationTimeZone: 'America/Los_Angeles',
        locationAddressSnapshot: { formattedAddress: '123 Salon St' },
        locationLatSnapshot: 34.05,
        locationLngSnapshot: -118.25,
      })

      const result = await GET(new Request('http://localhost'), makeCtx('hold_1'))

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        descriptor.httpStatus,
        descriptor.userMessage,
        {
          code: descriptor.code,
          retryable: descriptor.retryable,
          uiAction: descriptor.uiAction,
          message: descriptor.message,
        },
      )

      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('returns the hold payload when valid', async () => {
      const result = await GET(new Request('http://localhost'), makeCtx('hold_1'))

      expect(mocks.jsonOk).toHaveBeenCalledWith(
        {
          hold: {
            id: 'hold_1',
            scheduledFor: '2026-03-11T19:30:00.000Z',
            expiresAt: '2099-03-11T19:45:00.000Z',
            expired: false,
            professionalId: 'pro_1',
            offeringId: 'offering_1',
            locationType: ServiceLocationType.SALON,
            locationId: 'loc_1',
            locationTimeZone: 'America/Los_Angeles',
            locationAddressSnapshot: { formattedAddress: '123 Salon St' },
            locationLatSnapshot: 34.05,
            locationLngSnapshot: -118.25,
          },
        },
        200,
      )

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: {
          hold: {
            id: 'hold_1',
            scheduledFor: '2026-03-11T19:30:00.000Z',
            expiresAt: '2099-03-11T19:45:00.000Z',
            expired: false,
            professionalId: 'pro_1',
            offeringId: 'offering_1',
            locationType: ServiceLocationType.SALON,
            locationId: 'loc_1',
            locationTimeZone: 'America/Los_Angeles',
            locationAddressSnapshot: { formattedAddress: '123 Salon St' },
            locationLatSnapshot: 34.05,
            locationLngSnapshot: -118.25,
          },
        },
      })
    })

    it('marks expired=true when hold is expired', async () => {
      mocks.bookingHoldFindUnique.mockResolvedValueOnce({
        id: 'hold_1',
        clientId: 'client_1',
        professionalId: 'pro_1',
        offeringId: 'offering_1',
        scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
        expiresAt: new Date('2000-01-01T00:00:00.000Z'),
        locationType: ServiceLocationType.MOBILE,
        locationId: 'loc_mobile',
        locationTimeZone: 'America/Los_Angeles',
        locationAddressSnapshot: null,
        locationLatSnapshot: null,
        locationLngSnapshot: null,
      })

      const result = await GET(new Request('http://localhost'), makeCtx('hold_1'))

      expect(mocks.jsonOk).toHaveBeenCalledWith(
        {
          hold: {
            id: 'hold_1',
            scheduledFor: '2026-03-11T19:30:00.000Z',
            expiresAt: '2000-01-01T00:00:00.000Z',
            expired: true,
            professionalId: 'pro_1',
            offeringId: 'offering_1',
            locationType: ServiceLocationType.MOBILE,
            locationId: 'loc_mobile',
            locationTimeZone: 'America/Los_Angeles',
            locationAddressSnapshot: null,
            locationLatSnapshot: null,
            locationLngSnapshot: null,
          },
        },
        200,
      )

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: {
          hold: {
            id: 'hold_1',
            scheduledFor: '2026-03-11T19:30:00.000Z',
            expiresAt: '2000-01-01T00:00:00.000Z',
            expired: true,
            professionalId: 'pro_1',
            offeringId: 'offering_1',
            locationType: ServiceLocationType.MOBILE,
            locationId: 'loc_mobile',
            locationTimeZone: 'America/Los_Angeles',
            locationAddressSnapshot: null,
            locationLatSnapshot: null,
            locationLngSnapshot: null,
          },
        },
      })
    })

    it('returns 500 when GET throws', async () => {
      mocks.bookingHoldFindUnique.mockRejectedValueOnce(new Error('db blew up'))

      const result = await GET(new Request('http://localhost'), makeCtx('hold_1'))

      expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Failed to load hold.')
      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Failed to load hold.',
      })
    })
  })

  describe('DELETE', () => {
    it('returns auth response when client auth fails', async () => {
      const authRes = { ok: false, status: 401, error: 'Unauthorized' }
      mocks.requireClient.mockResolvedValueOnce({
        ok: false,
        res: authRes,
      })

      const result = await DELETE(
        new Request('http://localhost'),
        makeCtx('hold_1'),
      )

      expect(result).toBe(authRes)
      expect(mocks.releaseHold).not.toHaveBeenCalled()
    })

    it('returns HOLD_ID_REQUIRED when hold id is missing', async () => {
      const descriptor = getBookingErrorDescriptor('HOLD_ID_REQUIRED')

      const result = await DELETE(new Request('http://localhost'), makeCtx(''))

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        descriptor.httpStatus,
        descriptor.userMessage,
        {
          code: descriptor.code,
          retryable: descriptor.retryable,
          uiAction: descriptor.uiAction,
          message: descriptor.message,
        },
      )

      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('releases a caller-owned hold through the write boundary', async () => {
      mocks.releaseHold.mockResolvedValueOnce({
        holdId: 'hold_1',
        professionalId: 'pro_1',
        meta: {
          mutated: true,
          noOp: false,
        },
      })

      const result = await DELETE(
        new Request('http://localhost'),
        makeCtx('hold_1'),
      )

      expect(mocks.releaseHold).toHaveBeenCalledWith({
        holdId: 'hold_1',
        clientId: 'client_1',
      })

      // The client walked away, so the minutes are free again and the pro's
      // "Checkout in progress" tile has to go — the other half of the ping the
      // create route sends. Without it the pro sat on an abandoned reservation
      // until its countdown ran out.
      expect(mocks.broadcastChange).toHaveBeenCalledWith({
        topic: 'bookings',
        professionalId: 'pro_1',
      })

      expect(mocks.jsonOk).toHaveBeenCalledWith(
        {
          deleted: true,
          holdId: 'hold_1',
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
          deleted: true,
          holdId: 'hold_1',
          meta: {
            mutated: true,
            noOp: false,
          },
        },
      })
    })

    it('maps booking errors from releaseHold', async () => {
      const descriptor = getBookingErrorDescriptor('HOLD_FORBIDDEN')

      mocks.releaseHold.mockRejectedValueOnce(new BookingError('HOLD_FORBIDDEN'))

      const result = await DELETE(
        new Request('http://localhost'),
        makeCtx('hold_1'),
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        descriptor.httpStatus,
        descriptor.userMessage,
        {
          code: descriptor.code,
          retryable: descriptor.retryable,
          uiAction: descriptor.uiAction,
          message: descriptor.message,
        },
      )

      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('returns 500 when DELETE throws a non-booking error', async () => {
      mocks.releaseHold.mockRejectedValueOnce(new Error('db blew up'))

      const result = await DELETE(
        new Request('http://localhost'),
        makeCtx('hold_1'),
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'Failed to release hold.',
      )

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Failed to release hold.',
      })
    })
  })

  describe('PATCH', () => {
    it('forwards the parsed selection and serializes the re-sized hold', async () => {
      const result = await PATCH(
        patchRequest({ addOnIds: ['addon_1', 'addon_2'] }),
        makeCtx('hold_1'),
      )

      expect(mocks.updateHoldAddOns).toHaveBeenCalledWith({
        holdId: 'hold_1',
        clientId: 'client_1',
        addOnIds: ['addon_1', 'addon_2'],
      })

      expect(result).toEqual({
        ok: true,
        status: 200,
        data: {
          hold: {
            id: 'hold_1',
            scheduledFor: '2026-03-11T19:30:00.000Z',
            expiresAt: '2099-03-11T19:45:00.000Z',
            durationMinutes: 90,
            endsAt: '2026-03-11T21:00:00.000Z',
          },
          meta: { mutated: true, noOp: false },
        },
      })
    })

    it('tells the pro’s calendar the reservation just grew', async () => {
      await PATCH(patchRequest({ addOnIds: ['addon_1'] }), makeCtx('hold_1'))

      // A widen MOVES the hold's end, so the anonymous tile on the pro's grid
      // has to grow with it — otherwise the pro is looking at a reservation
      // that is smaller than the one the finalize will take.
      expect(mocks.broadcastChange).toHaveBeenCalledWith({
        topic: 'bookings',
        professionalId: 'pro_1',
      })
    })

    it('does NOT ping when the re-size changed nothing', async () => {
      mocks.updateHoldAddOns.mockResolvedValueOnce({
        hold: {
          id: 'hold_1',
          scheduledFor: new Date('2026-03-11T19:30:00.000Z'),
          expiresAt: new Date('2099-03-11T19:45:00.000Z'),
          durationMinutes: 90,
          endsAt: new Date('2026-03-11T21:00:00.000Z'),
        },
        professionalId: 'pro_1',
        meta: { mutated: false, noOp: true },
      })

      await PATCH(patchRequest({ addOnIds: ['addon_1'] }), makeCtx('hold_1'))

      // The selection is caller-controlled and re-sent on every page load. An
      // ungated ping would let a client rattle this pro's phone at will by
      // re-sending the add-ons they already have — the same reason the
      // schedule-version bump is gated on `mutated`.
      expect(mocks.broadcastChange).not.toHaveBeenCalled()
    })

    it('treats a missing addOnIds as clearing the selection', async () => {
      await PATCH(patchRequest({}), makeCtx('hold_1'))

      expect(mocks.updateHoldAddOns).toHaveBeenCalledWith({
        holdId: 'hold_1',
        clientId: 'client_1',
        addOnIds: [],
      })
    })

    it('refuses a duplicated add-on id without touching the boundary', async () => {
      const descriptor = getBookingErrorDescriptor('ADDONS_INVALID')

      const result = await PATCH(
        patchRequest({ addOnIds: ['addon_1', 'addon_1'] }),
        makeCtx('hold_1'),
      )

      expect(mocks.updateHoldAddOns).not.toHaveBeenCalled()
      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('returns auth response when client auth fails', async () => {
      const authRes = { ok: false, status: 401, error: 'Unauthorized' }
      mocks.requireClient.mockResolvedValueOnce({ ok: false, res: authRes })

      const result = await PATCH(patchRequest({ addOnIds: [] }), makeCtx('hold_1'))

      expect(result).toBe(authRes)
      expect(mocks.updateHoldAddOns).not.toHaveBeenCalled()
    })

    it('rejects a non-JSON body', async () => {
      const result = await PATCH(
        new Request('http://localhost', { method: 'PATCH', body: 'not json' }),
        makeCtx('hold_1'),
      )

      expect(mocks.updateHoldAddOns).not.toHaveBeenCalled()
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'Invalid JSON body.',
      })
    })

    it('surfaces a boundary refusal with its own booking code', async () => {
      const descriptor = getBookingErrorDescriptor('TIME_BOOKED')
      mocks.updateHoldAddOns.mockRejectedValueOnce(
        new BookingError('TIME_BOOKED'),
      )

      const result = await PATCH(
        patchRequest({ addOnIds: ['addon_1'] }),
        makeCtx('hold_1'),
      )

      expect(result).toEqual({
        ok: false,
        status: descriptor.httpStatus,
        error: descriptor.userMessage,
        code: descriptor.code,
        retryable: descriptor.retryable,
        uiAction: descriptor.uiAction,
        message: descriptor.message,
      })
    })

    it('returns 500 when the boundary throws a non-booking error', async () => {
      mocks.updateHoldAddOns.mockRejectedValueOnce(new Error('db blew up'))

      const result = await PATCH(
        patchRequest({ addOnIds: ['addon_1'] }),
        makeCtx('hold_1'),
      )

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Failed to update hold.',
      })
    })
    it('refuses over the rate limit without touching the boundary', async () => {
      const limited = { ok: false, status: 429, error: 'Too many requests.' }
      mocks.enforceRateLimit.mockResolvedValueOnce({
        allowed: false,
        bucket: 'holds:update',
      })
      mocks.rateLimitExceededResponse.mockReturnValueOnce(limited)

      const result = await PATCH(
        patchRequest({ addOnIds: ['addon_1'] }),
        makeCtx('hold_1'),
      )

      // Each re-size takes the professional's schedule lock, so the ceiling has
      // to apply BEFORE the boundary, not after it.
      expect(mocks.updateHoldAddOns).not.toHaveBeenCalled()
      expect(result).toBe(limited)
    })
  })
})
