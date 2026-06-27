// app/api/v1/pro/last-minute/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  pickString: vi.fn(),
  upper: vi.fn(),
  requireProBooking: vi.fn(),
  offeringFindFirst: vi.fn(),
  computeLastMinuteDiscount: vi.fn(),
  updateBookingLastMinuteDiscount: vi.fn(),
  readJsonRecord: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
  pickString: mocks.pickString,
  upper: mocks.upper,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalServiceOffering: { findFirst: mocks.offeringFindFirst },
  },
}))

vi.mock('@/app/api/_utils/auth/requireProBooking', () => ({
  requireProBooking: mocks.requireProBooking,
}))

vi.mock('@/lib/lastMinutePricing', () => ({
  computeLastMinuteDiscount: mocks.computeLastMinuteDiscount,
}))

vi.mock('@/lib/booking/writeBoundary', () => ({
  updateBookingLastMinuteDiscount: mocks.updateBookingLastMinuteDiscount,
}))

vi.mock('@/app/api/_utils/readJsonRecord', () => ({
  readJsonRecord: mocks.readJsonRecord,
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/pro/last-minute', { method: 'POST' })
}

const PRO_ID = 'pro_1'

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking_1',
    serviceId: 'svc_1',
    offeringId: 'off_1',
    scheduledFor: new Date('2026-07-01T10:00:00.000Z'),
    locationType: 'SALON',
    locationTimeZone: 'America/Los_Angeles',
    subtotalSnapshot: new Prisma.Decimal('100.00'),
    discountAmount: null,
    ...overrides,
  }
}

function makeOffering(overrides: Record<string, unknown> = {}) {
  return {
    id: 'off_1',
    professionalId: PRO_ID,
    serviceId: 'svc_1',
    offersInSalon: true,
    offersMobile: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  mocks.requirePro.mockResolvedValue({
    ok: true,
    professionalId: PRO_ID,
    proId: PRO_ID,
    user: { id: 'user_1' },
  })
  mocks.pickString.mockImplementation((v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
  )
  mocks.upper.mockImplementation((v: unknown) =>
    typeof v === 'string' ? v.trim().toUpperCase() : '',
  )
  mocks.jsonFail.mockImplementation(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
  )
  mocks.jsonOk.mockImplementation((payload: unknown, status = 200) =>
    makeJsonResponse(status, {
      ok: true,
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    }),
  )

  mocks.readJsonRecord.mockResolvedValue({
    bookingId: 'booking_1',
    locationType: 'SALON',
  })
  mocks.requireProBooking.mockResolvedValue({ ok: true, booking: makeBooking() })
  mocks.offeringFindFirst.mockResolvedValue(makeOffering())
  mocks.computeLastMinuteDiscount.mockResolvedValue({
    discountAmount: 10,
    discountedPrice: 90,
    appliedPct: 10,
    window: 'OPENING_TIER',
    reason: null,
  })
  mocks.updateBookingLastMinuteDiscount.mockResolvedValue(undefined)
})

describe('POST /api/v1/pro/last-minute', () => {
  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const res = await POST(makeRequest())

    expect(res).toBe(authRes)
    expect(mocks.requireProBooking).not.toHaveBeenCalled()
  })

  it('rejects a missing bookingId', async () => {
    mocks.readJsonRecord.mockResolvedValueOnce({})

    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Missing bookingId.',
    })
    expect(mocks.requireProBooking).not.toHaveBeenCalled()
  })

  it('returns the ownership 404 when the booking is not owned by the pro', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse(404, { ok: false, error: 'Booking not found.' }),
    })

    const res = await POST(makeRequest())

    expect(mocks.requireProBooking).toHaveBeenCalledWith(
      'booking_1',
      PRO_ID,
      expect.objectContaining({ id: true, subtotalSnapshot: true }),
    )
    expect(res.status).toBe(404)
    expect(mocks.updateBookingLastMinuteDiscount).not.toHaveBeenCalled()
  })

  it('rejects when neither the booking nor the body supplies an offeringId', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: true,
      booking: makeBooking({ offeringId: null }),
    })
    mocks.readJsonRecord.mockResolvedValueOnce({ bookingId: 'booking_1' })

    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Missing offeringId (booking has no offeringId).',
    })
  })

  it('returns 404 when the offering is not found or inactive', async () => {
    mocks.offeringFindFirst.mockResolvedValueOnce(null)

    const res = await POST(makeRequest())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Offering not found or inactive.',
    })
  })

  it('rejects a salon booking for an offering not available in-salon', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: true,
      booking: makeBooking({ locationType: 'SALON' }),
    })
    mocks.offeringFindFirst.mockResolvedValueOnce(
      makeOffering({ offersInSalon: false }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'This offering is not available in-salon.',
    })
    expect(mocks.updateBookingLastMinuteDiscount).not.toHaveBeenCalled()
  })

  it('rejects a mobile booking for an offering not available as mobile', async () => {
    mocks.requireProBooking.mockResolvedValueOnce({
      ok: true,
      booking: makeBooking({ locationType: 'MOBILE' }),
    })
    mocks.offeringFindFirst.mockResolvedValueOnce(
      makeOffering({ offersMobile: false }),
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'This offering is not available as mobile.',
    })
  })

  it('computes the discount, persists it through the write boundary, and returns it', async () => {
    const res = await POST(makeRequest())

    expect(mocks.computeLastMinuteDiscount).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: PRO_ID,
        serviceId: 'svc_1',
        basePrice: 100,
        timeZone: 'America/Los_Angeles',
      }),
    )

    expect(mocks.updateBookingLastMinuteDiscount).toHaveBeenCalledTimes(1)
    const writeArg = mocks.updateBookingLastMinuteDiscount.mock.calls[0]?.[0] as {
      bookingId: string
      professionalId: string
      discountAmount: Prisma.Decimal
    }
    expect(writeArg.bookingId).toBe('booking_1')
    expect(writeArg.professionalId).toBe(PRO_ID)
    expect(writeArg.discountAmount.toString()).toBe('10')

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      bookingId: 'booking_1',
      basePrice: 100,
      discount: { discountAmount: 10, appliedPct: 10 },
    })
  })
})
