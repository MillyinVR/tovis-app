// app/api/v1/client/consult/availability/route.test.ts
import { BookingStatus } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { addElapsedDays } from '@/lib/time'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn((status: number, message: string, extra?: unknown) => ({
    status,
    message,
    extra,
  })),
  jsonOk: vi.fn((body: unknown, status = 200) => ({ status, body })),
  requireClientBookingOwnership: vi.fn(),
  findUniqueBooking: vi.fn(),
  findUniqueConsultSession: vi.fn(),
}))

vi.mock('@/app/api/_utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/api/_utils')>(
    '@/app/api/_utils',
  )
  return {
    ...actual,
    requireClient: mocks.requireClient,
    jsonFail: mocks.jsonFail,
    jsonOk: mocks.jsonOk,
  }
})

vi.mock('@/app/api/_utils/auth/requireClientBookingOwnership', () => ({
  requireClientBookingOwnership: mocks.requireClientBookingOwnership,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findUnique: mocks.findUniqueBooking },
    consultSession: { findUnique: mocks.findUniqueConsultSession },
  },
}))

import { GET } from './route'

type Res = { status: number; message?: string; body?: unknown }

const NOW = new Date('2026-08-06T10:00:00.000Z')
const ROUTE_NOW = new Date('2026-08-07T12:00:00.000Z')
const UPCOMING = addElapsedDays(ROUTE_NOW, 7)

const CONSULT_ROW = {
  id: 'consult_1',
  status: 'CONSENT_REQUIRED',
  bookingId: 'booking_1',
  professionalId: 'pro_allowlisted',
  serviceCategoryId: 'cat_hair_color',
  createdAt: NOW,
  clientId: 'client_1',
}

function get(query = '?bookingId=booking_1'): Promise<Res> {
  return GET(
    new Request(`http://test/api/v1/client/consult/availability${query}`),
  ) as Promise<Res>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(ROUTE_NOW)
  vi.clearAllMocks()
  process.env.ENABLE_AI_CONSULT = '1'
  mocks.requireClient.mockResolvedValue({
    ok: true,
    clientId: 'client_1',
    user: { id: 'user_1' },
  })
  mocks.requireClientBookingOwnership.mockResolvedValue({ ok: true })
  mocks.findUniqueBooking.mockResolvedValue({
    status: BookingStatus.ACCEPTED,
    scheduledFor: UPCOMING,
    professionalId: 'pro_allowlisted',
    service: {
      categoryId: 'cat_hair_color',
      category: { slug: 'hair-color' },
    },
  })
  mocks.findUniqueConsultSession.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.ENABLE_AI_CONSULT
})

describe('GET /api/v1/client/consult/availability', () => {
  it('400s without a bookingId', async () => {
    const res = await get('')
    expect(res.status).toBe(400)
    expect(mocks.requireClientBookingOwnership).not.toHaveBeenCalled()
  })

  it('propagates the booking-ownership refusal (no-leak 404)', async () => {
    mocks.requireClientBookingOwnership.mockResolvedValue({
      ok: false,
      res: { status: 404, message: 'Booking not found.' },
    })
    const res = await get()
    expect(res.status).toBe(404)
    expect(mocks.findUniqueBooking).not.toHaveBeenCalled()
  })

  it('404s when the booking row is missing after the ownership check', async () => {
    mocks.findUniqueBooking.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
  })

  it('answers available with no session for an eligible booking', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: { available: true, consult: null },
    })
  })

  it('answers available with the owned session attached', async () => {
    mocks.findUniqueConsultSession.mockResolvedValue(CONSULT_ROW)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: {
        available: true,
        consult: {
          id: 'consult_1',
          status: 'CONSENT_REQUIRED',
          bookingId: 'booking_1',
          professionalId: 'pro_allowlisted',
          serviceCategoryId: 'cat_hair_color',
          createdAt: NOW.toISOString(),
        },
      },
    })
  })

  it('answers unavailable (200, no reason) when the pilot gate is off for the pro', async () => {
    delete process.env.ENABLE_AI_CONSULT
    mocks.findUniqueBooking.mockResolvedValue({
      status: BookingStatus.ACCEPTED,
      scheduledFor: UPCOMING,
      professionalId: 'some-other-pro',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: { available: false, consult: null },
    })
  })

  it('answers available for an allowlisted pro even with the global flag off', async () => {
    delete process.env.ENABLE_AI_CONSULT
    mocks.findUniqueBooking.mockResolvedValue({
      status: BookingStatus.ACCEPTED,
      scheduledFor: UPCOMING,
      professionalId: 'cmq9p645v0002jp04fttoatlq',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: { available: true, consult: null },
    })
  })

  it.each([
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NO_SHOW,
  ])('answers unavailable for a %s booking', async (status) => {
    mocks.findUniqueBooking.mockResolvedValue({
      status,
      scheduledFor: UPCOMING,
      professionalId: 'pro_allowlisted',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: { available: false, consult: null },
    })
  })

  it('answers unavailable outside the 90-day pilot window', async () => {
    mocks.findUniqueBooking.mockResolvedValue({
      status: BookingStatus.ACCEPTED,
      scheduledFor: addElapsedDays(ROUTE_NOW, 91),
      professionalId: 'pro_allowlisted',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: { available: false, consult: null },
    })
  })

  it('answers unavailable, hiding the session, when it belongs to another client', async () => {
    mocks.findUniqueConsultSession.mockResolvedValue({
      ...CONSULT_ROW,
      clientId: 'someone_else',
    })
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      availability: { available: false, consult: null },
    })
  })
})
