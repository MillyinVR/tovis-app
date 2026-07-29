import { BookingStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BOOKING_BLOCKING_STATUSES } from '@/lib/booking/constants'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  bookingFindMany: vi.fn(),
  calendarBlockFindMany: vi.fn(),
  professionalProfileFindUnique: vi.fn(),
  loadOpenSlotDays: vi.fn(),
}))

vi.mock('@/lib/availability/data/openSlotDays', () => ({
  loadOpenSlotDays: mocks.loadOpenSlotDays,
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

  // The route's own parser used to reject impossible-but-well-formed dates;
  // R4 consolidated it into summaryWindow's parser, which was made strict so
  // the merge kept this behaviour. Pin it: "2026-02-31" must 400, not roll
  // forward to March 3.
  it('rejects a well-formed date that does not exist on the calendar', async () => {
    const res = await GET(req('from=2026-02-31&to=2026-03-15'))
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

  // Regression: the walk used to start at the BLOCK's first day with an
  // iteration cap, so a block longer than the cap ran out of steps before it
  // reached the requested window — a months-long closure left every day in the
  // picker looking free. The walk is now clamped to the requested range.
  it('marks the range as blocked for a block that spans far beyond it', async () => {
    mocks.calendarBlockFindMany.mockResolvedValue([
      {
        startsAt: new Date('2026-01-05T08:00:00.000Z'),
        endsAt: new Date('2026-12-20T08:00:00.000Z'),
      },
    ])

    const res = await GET(req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles'))
    const data = await body(res)
    const days = data.days as Record<string, { blocked: boolean }>

    expect(days['2026-09-01']?.blocked).toBe(true)
    expect(days['2026-09-15']?.blocked).toBe(true)
    expect(days['2026-09-30']?.blocked).toBe(true)
    expect(Object.keys(days)).toHaveLength(30)
  })

  it('falls back to the profile timezone when tz param is absent/invalid', async () => {
    await GET(req('from=2026-09-01&to=2026-09-30&tz=Not/AZone'))
    expect(mocks.professionalProfileFindUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: { timeZone: true },
    })
  })

  // R4 — the open-slot overlay.

  it('stays busy-only, with a null openSlots envelope, when no serviceId is sent', async () => {
    const res = await GET(req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles'))
    const data = await body(res)

    expect(mocks.loadOpenSlotDays).not.toHaveBeenCalled()
    expect(data.openSlots).toBeNull()
  })

  it('counts open slots for the requested service and zero-fills the range', async () => {
    mocks.loadOpenSlotDays.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
      durationMinutes: 90,
      // Only two days have openings; every OTHER day in range must still come
      // back with an explicit 0 — "fully booked" and "never counted" must not
      // look alike to the grid.
      openSlots: { '2026-09-02': 4, '2026-09-05': 1 },
    })

    const res = await GET(
      req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles&serviceId=svc_1'),
    )
    const data = await body(res)
    const days = data.days as Record<string, { openSlots?: number }>

    expect(data.openSlots).toEqual({
      computed: true,
      durationMinutes: 90,
      reason: null,
    })
    expect(days['2026-09-02']?.openSlots).toBe(4)
    expect(days['2026-09-05']?.openSlots).toBe(1)
    expect(days['2026-09-01']?.openSlots).toBe(0)
    expect(days['2026-09-30']?.openSlots).toBe(0)
    expect(Object.keys(days)).toHaveLength(30)
  })

  it('passes the service/location/reschedule context straight through', async () => {
    mocks.loadOpenSlotDays.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
      durationMinutes: 60,
      openSlots: {},
    })

    await GET(
      req(
        'from=2026-09-01&to=2026-09-30&serviceId=svc_1&locationType=MOBILE&locationId=loc_9&addOnIds=a2,a1&rescheduleBookingId=bk_7',
      ),
    )

    expect(mocks.loadOpenSlotDays).toHaveBeenCalledWith(
      expect.objectContaining({
        // Always the SESSION's pro — never a query param.
        professionalId: 'pro_1',
        serviceId: 'svc_1',
        requestedLocationType: 'MOBILE',
        requestedLocationId: 'loc_9',
        addOnIds: ['a1', 'a2'],
        rescheduleBookingId: 'bk_7',
        rebookOfBookingId: null,
        fromYmd: '2026-09-01',
        toYmd: '2026-09-30',
      }),
    )
  })

  // The aftercare surfaces size their counts from the SOURCE booking's clone
  // width (base + add-ons) via rebookOfBookingId.
  it('passes the rebook-of context straight through', async () => {
    mocks.loadOpenSlotDays.mockResolvedValue({
      ok: true,
      timeZone: 'America/Los_Angeles',
      durationMinutes: 135,
      openSlots: {},
    })

    await GET(
      req('from=2026-09-01&to=2026-09-30&serviceId=svc_1&rebookOfBookingId=bk_src'),
    )

    expect(mocks.loadOpenSlotDays).toHaveBeenCalledWith(
      expect.objectContaining({
        rebookOfBookingId: 'bk_src',
        rescheduleBookingId: null,
      }),
    )
  })

  // The counts are bucketed in the OFFERING's location zone. If the busy
  // buckets used the requested zone instead, the two overlays would key
  // different local days onto the same grid cell.
  it('buckets busy days in the zone the counts were computed in', async () => {
    mocks.loadOpenSlotDays.mockResolvedValue({
      ok: true,
      timeZone: 'America/New_York',
      durationMinutes: 60,
      openSlots: {},
    })
    mocks.bookingFindMany.mockResolvedValue([
      // 22:00 PDT Sep 10 == 01:00 EDT Sep 11: the two zones disagree on the day.
      { scheduledFor: new Date('2026-09-11T05:00:00.000Z') },
    ])

    const res = await GET(
      req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles&serviceId=svc_1'),
    )
    const data = await body(res)
    const days = data.days as Record<string, { bookings: number }>

    expect(data.tz).toBe('America/New_York')
    expect(days['2026-09-11']?.bookings).toBe(1)
    expect(days['2026-09-10']?.bookings).toBe(0)
  })

  it('degrades to the busy overlay, with a reason, when counting fails', async () => {
    mocks.loadOpenSlotDays.mockResolvedValue({
      ok: false,
      code: 'SERVICE_NOT_FOUND',
    })

    const res = await GET(
      req('from=2026-09-01&to=2026-09-30&tz=America/Los_Angeles&serviceId=svc_gone'),
    )
    const data = await body(res)
    const days = data.days as Record<string, { openSlots?: number }>

    // Still a 200 with a usable grid — a pro who can't get counts must still be
    // able to pick a day.
    expect(res.status).toBe(200)
    expect(data.openSlots).toEqual({
      computed: false,
      durationMinutes: null,
      reason: 'SERVICE_NOT_FOUND',
    })
    expect(Object.values(days).every((d) => d.openSlots === undefined)).toBe(true)
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
