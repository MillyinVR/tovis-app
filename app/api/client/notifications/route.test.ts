import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientNotificationType } from '@prisma/client'

const mockRequireClient = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({
  clientNotification: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { GET } from './route'

function makeRequest(search = '') {
  return new Request(
    `http://localhost/api/client/notifications${search}`,
    { method: 'GET' },
  )
}

function makeNotification(id: string, type: ClientNotificationType) {
  return {
    id,
    type,
    title: `Title ${id}`,
    body: `Body ${id}`,
    href: `/client/bookings/${id}`,
    data: { bookingId: id },
    createdAt: new Date(`2026-04-06T12:00:00.000Z`),
    updatedAt: new Date(`2026-04-06T12:00:00.000Z`),
    readAt: null,
    bookingId: `booking_${id}`,
    aftercareId: null,
  }
}

function toJsonNotification<T extends {
  createdAt: Date
  updatedAt: Date
}>(notification: T) {
  return {
    ...notification,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  }
}

describe('GET /api/client/notifications', () => {
  beforeEach(() => {
    mockRequireClient.mockReset()
    mockPrisma.clientNotification.findMany.mockReset()
  })

  it('returns the auth response when the client is unauthorized', async () => {
    const unauthorizedResponse = new Response(
      JSON.stringify({ ok: false, error: 'Unauthorized' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    )

    mockRequireClient.mockResolvedValue({
      ok: false,
      res: unauthorizedResponse,
    })

    const response = await GET(makeRequest())

    expect(response).toBe(unauthorizedResponse)
    expect(mockPrisma.clientNotification.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid notification type', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const response = await GET(makeRequest('?type=NOT_REAL'))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid notification type.',
    })
    expect(mockPrisma.clientNotification.findMany).not.toHaveBeenCalled()
  })

  it('returns the first page with default filters', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const rows = [
      makeNotification('notif_1', ClientNotificationType.BOOKING_CONFIRMED),
      makeNotification('notif_2', ClientNotificationType.AFTERCARE),
    ]

    mockPrisma.clientNotification.findMany.mockResolvedValue(rows)

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(mockPrisma.clientNotification.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        href: true,
        data: true,
        createdAt: true,
        updatedAt: true,
        readAt: true,
        bookingId: true,
        aftercareId: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
    ok: true,
    items: rows.map(toJsonNotification),
    nextCursor: null,
    filters: {
        unreadOnly: false,
        type: null,
    },
    })
  })

  it('applies unread and type filters with cursor pagination', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const rows = Array.from({ length: 26 }, (_, index) =>
      makeNotification(
        `notif_${index + 1}`,
        ClientNotificationType.AFTERCARE,
      ),
    )

    mockPrisma.clientNotification.findMany.mockResolvedValue(rows)

    const response = await GET(
      makeRequest(
        '?take=25&cursor=notif_cursor&unread=true&type=AFTERCARE',
      ),
    )
    const json = await response.json()

    expect(mockPrisma.clientNotification.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
        readAt: null,
        type: ClientNotificationType.AFTERCARE,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 26,
      cursor: { id: 'notif_cursor' },
      skip: 1,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        href: true,
        data: true,
        createdAt: true,
        updatedAt: true,
        readAt: true,
        bookingId: true,
        aftercareId: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
    ok: true,
    items: rows.slice(0, 25).map(toJsonNotification),
    nextCursor: 'notif_25',
    filters: {
        unreadOnly: true,
        type: ClientNotificationType.AFTERCARE,
    },
    })
  })

  it('clamps take to the allowed max of 100', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockPrisma.clientNotification.findMany.mockResolvedValue([])

    const response = await GET(makeRequest('?take=999'))
    const json = await response.json()

    expect(mockPrisma.clientNotification.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        href: true,
        data: true,
        createdAt: true,
        updatedAt: true,
        readAt: true,
        bookingId: true,
        aftercareId: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
      filters: {
        unreadOnly: false,
        type: null,
      },
    })
  })

  it('treats invalid unread values as no unread filter', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockPrisma.clientNotification.findMany.mockResolvedValue([])

    const response = await GET(makeRequest('?unread=banana'))
    const json = await response.json()

    expect(mockPrisma.clientNotification.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client_1',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        href: true,
        data: true,
        createdAt: true,
        updatedAt: true,
        readAt: true,
        bookingId: true,
        aftercareId: true,
      },
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
      filters: {
        unreadOnly: false,
        type: null,
      },
    })
  })

  it('returns 500 when loading notifications fails', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.clientNotification.findMany.mockRejectedValueOnce(
      new Error('Notifications blew up'),
    )

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Notifications blew up',
    })

    errorSpy.mockRestore()
  })
})