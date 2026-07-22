import { BookingStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  bookingFindMany: vi.fn(),
  calendarBlockFindMany: vi.fn(),
  professionalProfileFindUnique: vi.fn(),
}))

vi.mock('@/app/api/_utils', async (orig) => ({
  ...(await orig<typeof import('@/app/api/_utils')>()),
  requirePro: mocks.requirePro,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: { findMany: mocks.bookingFindMany },
    calendarBlock: { findMany: mocks.calendarBlockFindMany },
    professionalProfile: { findUnique: mocks.professionalProfileFindUnique },
  },
}))

import { GET } from './route'

function req(query: string): Request {
  return new Request(`https://x.test/api/v1/pro/availability/busy-days?${query}`)
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('GET /api/v1/pro/availability/busy-days', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      proId: 'pro_1',
      userId: 'user_1',
      user: { id: 'user_1' },
    })
    mocks.bookingFindMany.mockResolvedValue([])
    mocks.calendarBlockFindMany.mockResolvedValue([])
    mocks.professionalProfileFindUnique.mockResolvedValue({
      timeZone: 'America/Los_Angeles',
    })
  })

  it('rejects missing/invalid date params', async () => {
    const res = await GET(req('from=nope&to=2026-09-30'))
    expect(res.status).toBe(400)
  })

  // F8: this popup used to keep its own status list, omitting COMPLETED on the
  // theory that "completed is past" — false for an early-finished or same-day
  // session, and it made the pro's own busy-day view disagree with what
  // availability would actually let them book.
  it('asks for exactly the shared occupancy statuses, not a local copy', async () => {
    await GET(req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles'))

    const where = mocks.bookingFindMany.mock.calls[0]?.[0]?.where
    expect(where?.status).toEqual({ in: [...BOOKING_BLOCKING_STATUSES] })
    expect(BOOKING_BLOCKING_STATUSES).toContain(BookingStatus.COMPLETED)
    expect(BOOKING_BLOCKING_STATUSES).not.toContain(BookingStatus.CANCELLED)
    expect(BOOKING_BLOCKING_STATUSES).not.toContain(BookingStatus.NO_SHOW)
  })

  it('buckets occupying bookings by local day in the pro timezone', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { scheduledFor: new Date('2026-09-10T20:00:00.000Z') }, // 13:00 PDT -> Sep 10
      { scheduledFor: new Date('2026-09-11T02:00:00.000Z') }, // 19:00 PDT -> Sep 10
      { scheduledFor: new Date('2026-09-12T16:00:00.000Z') }, // 09:00 PDT -> Sep 12
    ])

    const res = await GET(req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles'))
    expect(res.status).toBe(200)
    const data = await body(res)
    const days = data.days as Record<string, { bookings: number; blocked: boolean }>

    expect(days['2026-09-10']).toEqual({ bookings: 2, blocked: false })
    expect(days['2026-09-12']).toEqual({ bookings: 1, blocked: false })
    expect(days['2026-09-11']).toBeUndefined()
    expect(data.tz).toBe('America/Los_Angeles')

    // With an explicit valid tz param, the profile is not queried.
    expect(mocks.professionalProfileFindUnique).not.toHaveBeenCalled()
  })

  it('marks every local day a calendar block spans as blocked', async () => {
    mocks.calendarBlockFindMany.mockResolvedValue([
      {
        startsAt: new Date('2026-09-15T17:00:00.000Z'), // Sep 15 10:00 PDT
        endsAt: new Date('2026-09-17T01:00:00.000Z'), // Sep 16 18:00 PDT
      },
    ])

    const res = await GET(req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles'))
    const data = await body(res)
    const days = data.days as Record<string, { bookings: number; blocked: boolean }>

    expect(days['2026-09-15']?.blocked).toBe(true)
    expect(days['2026-09-16']?.blocked).toBe(true)
    expect(days['2026-09-17']).toBeUndefined()
  })

  it('falls back to the profile timezone when tz param is absent/invalid', async () => {
    await GET(req('from=2026-09-01&to=2026-09-30&tz=Not/AZone'))
    expect(mocks.professionalProfileFindUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { timeZone: true },
    })
  })

  it('returns the pro auth failure response when not a pro', async () => {
    mocks.requirePro.mockResolvedValue({
      ok: false,
      res: new Response('no', { status: 403 }),
    })
    const res = await GET(req('from=2026-09-01&to=2026-09-30'))
    expect(res.status).toBe(403)
  })
})
