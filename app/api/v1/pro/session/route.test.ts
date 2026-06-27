import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingStatus, MediaPhase, Role, SessionStep } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  bookingFindFirst: vi.fn(),
  bookingFindMany: vi.fn(),
  mediaAssetGroupBy: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findFirst: mocks.bookingFindFirst,
      findMany: mocks.bookingFindMany,
    },
    mediaAsset: {
      groupBy: mocks.mediaAssetGroupBy,
    },
  },
}))

import { GET } from './route'

const PRO_ID = 'pro_1'

function makeBooking(overrides?: {
  id?: string
  scheduledFor?: Date
  sessionStep?: SessionStep | null
  firstName?: string
  lastName?: string
  email?: string | null
  serviceName?: string
  serviceItemName?: string | null
}) {
  const serviceItemName =
    overrides && 'serviceItemName' in overrides
      ? overrides.serviceItemName
      : null

  return {
    id: overrides?.id ?? 'booking_1',
    scheduledFor: overrides?.scheduledFor ?? new Date('2026-04-12T18:00:00.000Z'),
    sessionStep: overrides?.sessionStep ?? SessionStep.NONE,
    client: {
      firstName: overrides?.firstName ?? 'Tori',
      lastName: overrides?.lastName ?? 'Morales',
      user: {
        email: overrides?.email ?? 'tori@example.com',
      },
    },
    service: {
      name: overrides?.serviceName ?? 'Haircut',
    },
    serviceItems:
      serviceItemName === null
        ? []
        : [
            {
              sortOrder: 0,
              service: {
                name: serviceItemName,
              },
            },
          ],
  }
}

function expectActiveFindFirst() {
  expect(mocks.bookingFindFirst).toHaveBeenCalledWith({
    where: {
      professionalId: PRO_ID,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] },
      startedAt: {
        not: null,
      },
      finishedAt: null,
      // Bookings whose aftercare has already been sent are no longer the
      // active hands-on session, so the footer clears once aftercare goes out.
      OR: [
        { aftercareSummary: { is: null } },
        { aftercareSummary: { sentToClientAt: null } },
      ],
    },
    orderBy: {
      startedAt: 'desc',
    },
    select: expect.any(Object),
  })
}

describe('GET /api/v1/pro/session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-12T18:00:00.000Z'))
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: PRO_ID,
      userId: 'user_1',
      user: { id: 'user_1' },
    })

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.jsonFail.mockImplementation((status: number, error: string) => ({
      ok: false,
      status,
      error,
    }))

    mocks.bookingFindFirst.mockResolvedValue(null)
    mocks.bookingFindMany.mockResolvedValue([])
    mocks.mediaAssetGroupBy.mockResolvedValue([])
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET()

    expect(result).toBe(authRes)
    expect(mocks.bookingFindFirst).not.toHaveBeenCalled()
    expect(mocks.bookingFindMany).not.toHaveBeenCalled()
    expect(mocks.mediaAssetGroupBy).not.toHaveBeenCalled()
  })

  it('returns an active session when a started booking exists', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeBooking({
        id: 'booking_active',
        sessionStep: SessionStep.BEFORE_PHOTOS,
        serviceItemName: 'Balayage',
      }),
    )

    mocks.mediaAssetGroupBy.mockResolvedValueOnce([
      {
        phase: MediaPhase.BEFORE,
        _count: { _all: 1 },
      },
    ])

    const result = await GET()

    expectActiveFindFirst()

    expect(mocks.mediaAssetGroupBy).toHaveBeenCalledWith({
      by: ['phase'],
      where: {
        bookingId: 'booking_active',
        phase: {
          in: [MediaPhase.BEFORE, MediaPhase.AFTER],
        },
        uploadedByRole: Role.PRO,
      },
      _count: {
        _all: true,
      },
    })

    expect(mocks.bookingFindMany).not.toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'ACTIVE',
        targetStep: 'session',
        booking: {
          id: 'booking_active',
          sessionStep: SessionStep.BEFORE_PHOTOS,
          serviceName: 'Balayage',
          clientName: 'Tori Morales',
          scheduledFor: '2026-04-12T18:00:00.000Z',
        },
        eligibleBookings: null,
        center: {
          label: 'Start service',
          action: 'NAVIGATE',
          href: '/pro/bookings/booking_active/session',
        },
      },
    })
  })

  it('excludes bookings whose aftercare was already sent from the active session', async () => {
    // Default mocks return no active booking; assert the query itself filters
    // out aftercare-sent bookings so the footer clears once aftercare goes out.
    await GET()

    expect(mocks.bookingFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          finishedAt: null,
          OR: [
            { aftercareSummary: { is: null } },
            { aftercareSummary: { sentToClientAt: null } },
          ],
        }),
      }),
    )
  })

  it('uses fallback service name and client email when name fields are blank', async () => {
    mocks.bookingFindFirst.mockResolvedValueOnce(
      makeBooking({
        id: 'booking_active',
        sessionStep: SessionStep.NONE,
        firstName: '',
        lastName: '',
        email: 'client@example.com',
        serviceName: 'Color',
        serviceItemName: null,
      }),
    )

    const result = await GET()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: expect.objectContaining({
        mode: 'ACTIVE',
        booking: expect.objectContaining({
          id: 'booking_active',
          serviceName: 'Color',
          clientName: 'client@example.com',
        }),
        center: {
          label: 'Consult',
          action: 'NAVIGATE',
          href: '/pro/bookings/booking_active/session',
        },
      }),
    })
  })

  it('returns one upcoming booking inside the start window as one-tap start', async () => {
    mocks.bookingFindMany.mockResolvedValueOnce([
      makeBooking({
        id: 'booking_upcoming',
        sessionStep: SessionStep.NONE,
      }),
    ])

    const result = await GET()

    expect(mocks.bookingFindMany).toHaveBeenCalledWith({
      where: {
        professionalId: PRO_ID,
        status: BookingStatus.ACCEPTED,
        startedAt: null,
        finishedAt: null,
        scheduledFor: {
          gte: new Date('2026-04-12T17:45:00.000Z'),
          lte: new Date('2026-04-12T18:15:00.000Z'),
        },
      },
      orderBy: [
        {
          scheduledFor: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      select: expect.any(Object),
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'UPCOMING',
        targetStep: 'consult',
        booking: {
          id: 'booking_upcoming',
          sessionStep: SessionStep.NONE,
          serviceName: 'Haircut',
          clientName: 'Tori Morales',
          scheduledFor: '2026-04-12T18:00:00.000Z',
        },
        eligibleBookings: null,
        center: {
          label: 'Start',
          action: 'START',
          href: '/pro/bookings/booking_upcoming/session',
        },
      },
    })
  })

  it('returns a picker when multiple upcoming bookings are inside the start window', async () => {
    mocks.bookingFindMany.mockResolvedValueOnce([
      makeBooking({
        id: 'booking_a',
        scheduledFor: new Date('2026-04-12T17:55:00.000Z'),
        serviceName: 'Cut',
      }),
      makeBooking({
        id: 'booking_b',
        scheduledFor: new Date('2026-04-12T18:05:00.000Z'),
        serviceName: 'Color',
      }),
    ])

    const result = await GET()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'UPCOMING_PICKER',
        targetStep: 'consult',
        booking: null,
        eligibleBookings: [
          {
            id: 'booking_a',
            sessionStep: SessionStep.NONE,
            serviceName: 'Cut',
            clientName: 'Tori Morales',
            scheduledFor: '2026-04-12T17:55:00.000Z',
          },
          {
            id: 'booking_b',
            sessionStep: SessionStep.NONE,
            serviceName: 'Color',
            clientName: 'Tori Morales',
            scheduledFor: '2026-04-12T18:05:00.000Z',
          },
        ],
        center: {
          label: 'Choose booking',
          action: 'PICK_BOOKING',
          href: null,
        },
      },
    })
  })

  it('returns idle payload when there is no active or eligible upcoming booking', async () => {
    const result = await GET()

    expect(mocks.bookingFindFirst).toHaveBeenCalled()
    expect(mocks.bookingFindMany).toHaveBeenCalled()

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        ok: true,
        mode: 'IDLE',
        targetStep: null,
        booking: null,
        eligibleBookings: null,
        center: {
          label: 'Start',
          action: 'NONE',
          href: null,
        },
      },
    })
  })

  it('returns 500 when the route throws unexpectedly', async () => {
    mocks.bookingFindFirst.mockRejectedValueOnce(new Error('db exploded'))

    const result = await GET()

    expect(mocks.jsonFail).toHaveBeenCalledWith(500, 'Internal server error')
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Internal server error',
    })
  })
})
