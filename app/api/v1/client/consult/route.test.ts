// app/api/v1/client/consult/route.test.ts
import { BookingStatus } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

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
  upsertConsultSession: vi.fn(),
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
    consultSession: { upsert: mocks.upsertConsultSession },
  },
}))

import { POST } from './route'

type Res = { status: number; message?: string; body?: unknown }

const NOW = new Date('2026-08-06T10:00:00.000Z')
const ROUTE_NOW = new Date('2026-08-07T12:00:00.000Z')
const UPCOMING = addElapsedDays(ROUTE_NOW, 7)

const CONSULT_ROW = {
  id: 'consult_1',
  status: 'CREATED',
  bookingId: 'booking_1',
  professionalId: 'pro_allowlisted',
  serviceCategoryId: 'cat_hair_color',
  createdAt: NOW,
}

function post(body: Record<string, unknown>): Promise<Res> {
  return POST(
    new Request('http://test/api/v1/client/consult', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ) as Promise<Res>
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(ROUTE_NOW)
  vi.clearAllMocks()
  process.env.ENABLE_AI_CONSULT = '1'
  mocks.requireClient.mockResolvedValue({ ok: true, clientId: 'client_1', user: { id: 'user_1' } })
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
  mocks.upsertConsultSession.mockResolvedValue(CONSULT_ROW)
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.ENABLE_AI_CONSULT
})

describe('POST /api/v1/client/consult', () => {
  it('400s without a bookingId', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('propagates the booking-ownership refusal (no-leak 404)', async () => {
    mocks.requireClientBookingOwnership.mockResolvedValue({
      ok: false,
      res: { status: 404, message: 'Booking not found.' },
    })
    const res = await post({ bookingId: 'booking_1' })
    expect(res.status).toBe(404)
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('404s when the booking row is missing after the ownership check', async () => {
    mocks.findUniqueBooking.mockResolvedValue(null)
    const res = await post({ bookingId: 'booking_1' })
    expect(res.status).toBe(404)
  })

  it('404s (never a distinguishing 403) when the pro is not gated in', async () => {
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
    const res = await post({ bookingId: 'booking_1' })
    expect(res.status).toBe(404)
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('allows a pro on the pilot allowlist even with the global flag off', async () => {
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
    const res = await post({ bookingId: 'booking_1' })
    expect(res.status).toBe(200)
  })

  it.each([
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.NO_SHOW,
  ])('409s rather than creating a consult for a %s booking', async (status) => {
    mocks.findUniqueBooking.mockResolvedValue({
      status,
      scheduledFor: UPCOMING,
      professionalId: 'pro_allowlisted',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })

    const res = await post({ bookingId: 'booking_1' })

    expect(res.status).toBe(409)
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'AI consultation is not available for this booking.',
      { code: 'BOOKING_NOT_UPCOMING' },
    )
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('keeps non-pilot service categories dark', async () => {
    mocks.findUniqueBooking.mockResolvedValue({
      status: BookingStatus.ACCEPTED,
      scheduledFor: UPCOMING,
      professionalId: 'pro_allowlisted',
      service: {
        categoryId: 'cat_brows',
        category: { slug: 'brows' },
      },
    })

    const res = await post({ bookingId: 'booking_1' })

    expect(res.status).toBe(404)
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('409s when the booking time has passed', async () => {
    mocks.findUniqueBooking.mockResolvedValue({
      status: BookingStatus.ACCEPTED,
      scheduledFor: new Date('2026-08-07T11:59:59.999Z'),
      professionalId: 'pro_allowlisted',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })

    const res = await post({ bookingId: 'booking_1' })

    expect(res.status).toBe(409)
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('409s outside the 90-day pilot window', async () => {
    mocks.findUniqueBooking.mockResolvedValue({
      status: BookingStatus.ACCEPTED,
      scheduledFor: addElapsedDays(ROUTE_NOW, 91),
      professionalId: 'pro_allowlisted',
      service: {
        categoryId: 'cat_hair_color',
        category: { slug: 'hair-color' },
      },
    })

    const res = await post({ bookingId: 'booking_1' })

    expect(res.status).toBe(409)
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'AI consultation is not available for this booking.',
      { code: 'BOOKING_OUTSIDE_PILOT_WINDOW' },
    )
    expect(mocks.upsertConsultSession).not.toHaveBeenCalled()
  })

  it('creates the session anchored to the booking, deriving the vertical from the booked service', async () => {
    const res = await post({ bookingId: 'booking_1' })

    expect(res.status).toBe(200)
    expect(mocks.upsertConsultSession).toHaveBeenCalledWith({
      where: { bookingId: 'booking_1' },
      create: {
        clientId: 'client_1',
        bookingId: 'booking_1',
        professionalId: 'pro_allowlisted',
        serviceCategoryId: 'cat_hair_color',
      },
      update: {},
    })
    expect(res.body).toEqual({
      consult: {
        id: 'consult_1',
        status: 'CREATED',
        bookingId: 'booking_1',
        professionalId: 'pro_allowlisted',
        serviceCategoryId: 'cat_hair_color',
        createdAt: NOW.toISOString(),
      },
    })
  })

  it('is idempotent under a retried create (upsert, not create)', async () => {
    await post({ bookingId: 'booking_1' })
    await post({ bookingId: 'booking_1' })
    expect(mocks.upsertConsultSession).toHaveBeenCalledTimes(2)
    for (const call of mocks.upsertConsultSession.mock.calls) {
      expect(call[0].where).toEqual({ bookingId: 'booking_1' })
    }
  })
})
