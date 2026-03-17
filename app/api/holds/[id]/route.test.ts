// app/api/holds/[id]/route.test.ts 
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceLocationType } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  pickString: vi.fn((value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null,
  ),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  bookingHoldFindUnique: vi.fn(),
  bookingHoldDeleteMany: vi.fn(),
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
      deleteMany: mocks.bookingHoldDeleteMany,
    },
  },
}))

import { GET, DELETE } from './route'

function makeCtx(id: string | null) {
  return {
    params: Promise.resolve(
      id == null ? ({} as { id: string }) : { id },
    ),
  }
}

describe('app/api/holds/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
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

    mocks.bookingHoldDeleteMany.mockResolvedValue({ count: 1 })
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

    it('returns 400 when hold id is missing', async () => {
      const result = await GET(new Request('http://localhost'), makeCtx(null))

      expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing hold id.')
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'Missing hold id.',
      })
    })

    it('returns 404 when hold does not exist', async () => {
      mocks.bookingHoldFindUnique.mockResolvedValueOnce(null)

      const result = await GET(new Request('http://localhost'), makeCtx('hold_404'))

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

      expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Hold not found.')
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: 'Hold not found.',
      })
    })

    it('returns 403 when hold belongs to another client', async () => {
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

      expect(mocks.jsonFail).toHaveBeenCalledWith(403, 'Forbidden.')
      expect(result).toEqual({
        ok: false,
        status: 403,
        error: 'Forbidden.',
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

      const result = await DELETE(new Request('http://localhost'), makeCtx('hold_1'))

      expect(result).toBe(authRes)
      expect(mocks.bookingHoldDeleteMany).not.toHaveBeenCalled()
    })

    it('returns 400 when hold id is missing', async () => {
      const result = await DELETE(new Request('http://localhost'), makeCtx(null))

      expect(mocks.jsonFail).toHaveBeenCalledWith(400, 'Missing hold id.')
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: 'Missing hold id.',
      })
    })

    it('deletes a caller-owned hold', async () => {
      mocks.bookingHoldDeleteMany.mockResolvedValueOnce({ count: 1 })

      const result = await DELETE(new Request('http://localhost'), makeCtx('hold_1'))

      expect(mocks.bookingHoldDeleteMany).toHaveBeenCalledWith({
        where: {
          id: 'hold_1',
          clientId: 'client_1',
        },
      })

      expect(mocks.jsonOk).toHaveBeenCalledWith({ deleted: true }, 200)
      expect(result).toEqual({
        ok: true,
        status: 200,
        data: { deleted: true },
      })
    })

    it('is idempotent when nothing is deleted', async () => {
      mocks.bookingHoldDeleteMany.mockResolvedValueOnce({ count: 0 })

      const result = await DELETE(new Request('http://localhost'), makeCtx('hold_missing'))

      expect(mocks.bookingHoldDeleteMany).toHaveBeenCalledWith({
        where: {
          id: 'hold_missing',
          clientId: 'client_1',
        },
      })

      expect(mocks.jsonOk).toHaveBeenCalledWith({ deleted: false }, 200)
      expect(result).toEqual({
        ok: true,
        status: 200,
        data: { deleted: false },
      })
    })

    it('returns 500 when DELETE throws', async () => {
      mocks.bookingHoldDeleteMany.mockRejectedValueOnce(new Error('db blew up'))

      const result = await DELETE(new Request('http://localhost'), makeCtx('hold_1'))

      expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Failed to release hold.')
      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Failed to release hold.',
      })
    })
  })
})