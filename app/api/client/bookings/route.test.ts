import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  ConsultationApprovalStatus,
  NotificationEventKey,
  WaitlistStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  upper: vi.fn(),

  prismaBookingFindMany: vi.fn(),
  prismaClientNotificationFindMany: vi.fn(),
  prismaWaitlistEntryFindMany: vi.fn(),

  buildClientBookingDTO: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    booking: {
      findMany: mocks.prismaBookingFindMany,
    },
    clientNotification: {
      findMany: mocks.prismaClientNotificationFindMany,
    },
    waitlistEntry: {
      findMany: mocks.prismaWaitlistEntryFindMany,
    },
  },
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/strings', () => ({
  upper: mocks.upper,
}))

vi.mock('@/lib/dto/clientBooking', () => ({
  buildClientBookingDTO: mocks.buildClientBookingDTO,
}))

import { GET, POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/client/bookings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function makeBookingRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'booking_1',
    status: 'ACCEPTED',
    source: 'DIRECT',
    sessionStep: 'NONE',
    scheduledFor: new Date('2026-04-20T18:00:00.000Z'),
    finishedAt: null,

    subtotalSnapshot: '100.00',
    serviceSubtotalSnapshot: '100.00',
    productSubtotalSnapshot: '0.00',
    totalAmount: '100.00',
    tipAmount: '0.00',
    taxAmount: '0.00',
    discountAmount: '0.00',
    checkoutStatus: 'UNPAID',
    selectedPaymentMethod: null,
    paymentAuthorizedAt: null,
    paymentCollectedAt: null,

    totalDurationMinutes: 60,
    bufferMinutes: 15,

    locationType: 'SALON',
    locationId: 'loc_1',
    locationTimeZone: 'America/Los_Angeles',
    locationAddressSnapshot: { formattedAddress: '123 Salon St' },

    service: {
      id: 'service_1',
      name: 'Haircut',
    },

    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      location: 'Main Studio',
      timeZone: 'America/Los_Angeles',
    },

    location: {
      id: 'loc_1',
      name: 'Main Studio',
      formattedAddress: '123 Salon St',
      city: 'Los Angeles',
      state: 'CA',
      timeZone: 'America/Los_Angeles',
    },

    consultationNotes: null,
    consultationPrice: null,
    consultationConfirmedAt: null,

    consultationApproval: null,

    serviceItems: [],
    productSales: [],

    ...(overrides ?? {}),
  }
}

function makeWaitlistRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'wait_1',
    createdAt: new Date('2026-04-10T10:00:00.000Z'),
    notes: 'Prefer afternoons',
    mediaId: null,
    status: WaitlistStatus.ACTIVE,
    preferenceType: 'ANYTIME',
    specificDate: null,
    timeOfDay: null,
    windowStartMin: null,
    windowEndMin: null,
    service: {
      id: 'service_1',
      name: 'Haircut',
    },
    professional: {
      id: 'pro_1',
      businessName: 'TOVIS Studio',
      location: 'Main Studio',
      timeZone: 'America/Los_Angeles',
    },
    ...(overrides ?? {}),
  }
}

describe('GET /api/client/bookings', () => {
  const NOW = new Date('2026-04-12T12:00:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mocks.upper.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return ''
      return value.trim().toUpperCase()
    })

    mocks.jsonOk.mockImplementation((data: Record<string, unknown>, status = 200) =>
      makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )

    mocks.buildClientBookingDTO.mockImplementation(
      ({
        booking,
        unreadAftercare,
        hasPendingConsultationApproval,
      }: {
        booking: Record<string, unknown>
        unreadAftercare: boolean
        hasPendingConsultationApproval: boolean
      }) => ({
        id: booking.id,
        status: booking.status,
        source: booking.source,
        scheduledFor:
          booking.scheduledFor instanceof Date
            ? booking.scheduledFor.toISOString()
            : booking.scheduledFor,
        hasPendingConsultationApproval,
        unreadAftercare,
      }),
    )

    mocks.prismaClientNotificationFindMany.mockResolvedValue([
      { bookingId: 'booking_aftercare' },
    ])

    mocks.prismaWaitlistEntryFindMany.mockResolvedValue([
      makeWaitlistRow(),
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns auth response when requireClient fails', async () => {
    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: makeJsonResponse(401, {
        ok: false,
        error: 'Unauthorized',
      }),
    })

    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Unauthorized',
    })

    expect(mocks.prismaBookingFindMany).not.toHaveBeenCalled()
    expect(mocks.prismaClientNotificationFindMany).not.toHaveBeenCalled()
    expect(mocks.prismaWaitlistEntryFindMany).not.toHaveBeenCalled()
  })

  it('loads bookings, derives pending state from current schema truth, and buckets correctly', async () => {
    const pendingByStep = makeBookingRow({
      id: 'booking_pending_step',
      sessionStep: 'CONSULTATION_PENDING_CLIENT',
      scheduledFor: new Date('2026-04-18T15:00:00.000Z'),
    })

    const pendingByApproval = makeBookingRow({
      id: 'booking_pending_approval',
      consultationApproval: {
        status: ConsultationApprovalStatus.PENDING,
        proposedServicesJson: null,
        proposedTotal: null,
        notes: null,
        approvedAt: null,
        rejectedAt: null,
      },
      scheduledFor: new Date('2026-04-19T15:00:00.000Z'),
    })

    const legacyStatusShouldNotCount = makeBookingRow({
      id: 'booking_legacy_status',
      consultationApproval: {
        status: 'SENT',
        proposedServicesJson: null,
        proposedTotal: null,
        notes: null,
        approvedAt: null,
        rejectedAt: null,
      },
      scheduledFor: new Date('2026-04-21T15:00:00.000Z'),
    })

    const pendingByBookingStatus = makeBookingRow({
      id: 'booking_pending_status',
      status: 'PENDING',
      scheduledFor: new Date('2026-04-22T15:00:00.000Z'),
    })

    const prebookedAftercare = makeBookingRow({
      id: 'booking_aftercare',
      source: 'AFTERCARE',
      scheduledFor: new Date('2026-04-23T15:00:00.000Z'),
    })

    const upcomingAccepted = makeBookingRow({
      id: 'booking_upcoming',
      scheduledFor: new Date('2026-04-24T15:00:00.000Z'),
    })

    const pastCompleted = makeBookingRow({
      id: 'booking_completed',
      status: 'COMPLETED',
      scheduledFor: new Date('2026-04-01T15:00:00.000Z'),
      finishedAt: new Date('2026-04-01T16:00:00.000Z'),
    })

    const pastAccepted = makeBookingRow({
      id: 'booking_past_accepted',
      status: 'ACCEPTED',
      scheduledFor: new Date('2026-04-05T15:00:00.000Z'),
    })

    mocks.prismaBookingFindMany.mockResolvedValue([
      pendingByStep,
      pendingByApproval,
      legacyStatusShouldNotCount,
      pendingByBookingStatus,
      prebookedAftercare,
      upcomingAccepted,
      pastCompleted,
      pastAccepted,
    ])

    const response = await GET()
    const json = await response.json()

    expect(mocks.prismaBookingFindMany).toHaveBeenCalledWith({
      where: { clientId: 'client_1' },
      orderBy: { scheduledFor: 'asc' },
      take: 300,
      select: expect.any(Object),
    })

    expect(mocks.prismaClientNotificationFindMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        eventKey: NotificationEventKey.AFTERCARE_READY,
        readAt: null,
        bookingId: { not: null },
      },
      select: { bookingId: true },
      take: 1000,
    })

    expect(mocks.prismaWaitlistEntryFindMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        status: WaitlistStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: expect.any(Object),
    })

    expect(mocks.buildClientBookingDTO).toHaveBeenCalledTimes(8)

    expect(mocks.buildClientBookingDTO).toHaveBeenCalledWith(
      expect.objectContaining({
        booking: expect.objectContaining({ id: 'booking_pending_step' }),
        hasPendingConsultationApproval: true,
        unreadAftercare: false,
      }),
    )

    expect(mocks.buildClientBookingDTO).toHaveBeenCalledWith(
      expect.objectContaining({
        booking: expect.objectContaining({ id: 'booking_pending_approval' }),
        hasPendingConsultationApproval: true,
        unreadAftercare: false,
      }),
    )

    expect(mocks.buildClientBookingDTO).toHaveBeenCalledWith(
      expect.objectContaining({
        booking: expect.objectContaining({ id: 'booking_legacy_status' }),
        hasPendingConsultationApproval: false,
        unreadAftercare: false,
      }),
    )

    expect(mocks.buildClientBookingDTO).toHaveBeenCalledWith(
      expect.objectContaining({
        booking: expect.objectContaining({ id: 'booking_aftercare' }),
        hasPendingConsultationApproval: false,
        unreadAftercare: true,
      }),
    )

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      buckets: {
        upcoming: [
          {
            id: 'booking_legacy_status',
            status: 'ACCEPTED',
            source: 'DIRECT',
            scheduledFor: '2026-04-21T15:00:00.000Z',
            hasPendingConsultationApproval: false,
            unreadAftercare: false,
          },
          {
            id: 'booking_upcoming',
            status: 'ACCEPTED',
            source: 'DIRECT',
            scheduledFor: '2026-04-24T15:00:00.000Z',
            hasPendingConsultationApproval: false,
            unreadAftercare: false,
          },
        ],
        pending: [
          {
            id: 'booking_pending_step',
            status: 'ACCEPTED',
            source: 'DIRECT',
            scheduledFor: '2026-04-18T15:00:00.000Z',
            hasPendingConsultationApproval: true,
            unreadAftercare: false,
          },
          {
            id: 'booking_pending_approval',
            status: 'ACCEPTED',
            source: 'DIRECT',
            scheduledFor: '2026-04-19T15:00:00.000Z',
            hasPendingConsultationApproval: true,
            unreadAftercare: false,
          },
          {
            id: 'booking_pending_status',
            status: 'PENDING',
            source: 'DIRECT',
            scheduledFor: '2026-04-22T15:00:00.000Z',
            hasPendingConsultationApproval: false,
            unreadAftercare: false,
          },
        ],
        waitlist: [
          {
            id: 'wait_1',
            createdAt: '2026-04-10T10:00:00.000Z',
            notes: 'Prefer afternoons',
            mediaId: null,
            status: WaitlistStatus.ACTIVE,
            preferenceType: 'ANYTIME',
            specificDate: null,
            timeOfDay: null,
            windowStartMin: null,
            windowEndMin: null,
            service: {
              id: 'service_1',
              name: 'Haircut',
            },
            professional: {
              id: 'pro_1',
              businessName: 'TOVIS Studio',
              location: 'Main Studio',
              timeZone: 'America/Los_Angeles',
            },
          },
        ],
        prebooked: [
          {
            id: 'booking_aftercare',
            status: 'ACCEPTED',
            source: 'AFTERCARE',
            scheduledFor: '2026-04-23T15:00:00.000Z',
            hasPendingConsultationApproval: false,
            unreadAftercare: true,
          },
        ],
        past: [
          {
            id: 'booking_completed',
            status: 'COMPLETED',
            source: 'DIRECT',
            scheduledFor: '2026-04-01T15:00:00.000Z',
            hasPendingConsultationApproval: false,
            unreadAftercare: false,
          },
          {
            id: 'booking_past_accepted',
            status: 'ACCEPTED',
            source: 'DIRECT',
            scheduledFor: '2026-04-05T15:00:00.000Z',
            hasPendingConsultationApproval: false,
            unreadAftercare: false,
          },
        ],
      },
      meta: {
        now: '2026-04-12T12:00:00.000Z',
        next30: '2026-05-12T12:00:00.000Z',
      },
    })
  })

  it('returns 500 when loading bookings fails', async () => {
    mocks.prismaBookingFindMany.mockRejectedValueOnce(new Error('db blew up'))

    const response = await GET()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to load client bookings.',
    })
  })
})

describe('POST /api/client/bookings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, {
          ok: false,
          error,
          ...(extra ?? {}),
        }),
    )
  })

  it('returns a deprecated endpoint response', async () => {
    const response = await POST(makeRequest({}))

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'This endpoint has been deprecated.',
      code: 'DEPRECATED_ENDPOINT',
      hint: {
        correctEndpoint: 'POST /api/bookings',
      },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      410,
      'This endpoint has been deprecated.',
      {
        code: 'DEPRECATED_ENDPOINT',
        hint: {
          correctEndpoint: 'POST /api/bookings',
        },
      },
    )
  })
})