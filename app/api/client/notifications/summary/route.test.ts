import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientNotificationType } from '@prisma/client'

const mockRequireClient = vi.hoisted(() => vi.fn())
const mockPrisma = vi.hoisted(() => ({
  clientNotification: {
    count: vi.fn(),
  },
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

import { GET } from './route'

describe('GET /api/client/notifications/summary', () => {
  beforeEach(() => {
    mockRequireClient.mockReset()
    mockPrisma.clientNotification.count.mockReset()
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

    const response = await GET()

    expect(response).toBe(unauthorizedResponse)
    expect(mockPrisma.clientNotification.count).not.toHaveBeenCalled()
  })

  it('returns grouped unread counts for pending, aftercare, and upcoming notifications', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockPrisma.clientNotification.count
      .mockResolvedValueOnce(2) // pendingUnreadCount
      .mockResolvedValueOnce(3) // aftercareUnreadCount
      .mockResolvedValueOnce(4) // upcomingUnreadCount

    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
    ok: true,
    pendingUnreadCount: 2,
    aftercareUnreadCount: 3,
    upcomingUnreadCount: 4,
    hasAnyUnreadUpdates: true,
    })

    expect(mockPrisma.clientNotification.count).toHaveBeenNthCalledWith(1, {
      where: {
        clientId: 'client_1',
        readAt: null,
        type: ClientNotificationType.CONSULTATION_PROPOSAL,
      },
    })

    expect(mockPrisma.clientNotification.count).toHaveBeenNthCalledWith(2, {
      where: {
        clientId: 'client_1',
        readAt: null,
        type: ClientNotificationType.AFTERCARE,
      },
    })

    expect(mockPrisma.clientNotification.count).toHaveBeenNthCalledWith(3, {
      where: {
        clientId: 'client_1',
        readAt: null,
        type: {
          in: [
            ClientNotificationType.BOOKING_CONFIRMED,
            ClientNotificationType.BOOKING_RESCHEDULED,
            ClientNotificationType.BOOKING_CANCELLED,
            ClientNotificationType.APPOINTMENT_REMINDER,
          ],
        },
      },
    })
  })

  it('returns hasAnyUnreadUpdates false when all unread counts are zero', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockPrisma.clientNotification.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)

    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({
    ok: true,
    pendingUnreadCount: 0,
    aftercareUnreadCount: 0,
    upcomingUnreadCount: 0,
    hasAnyUnreadUpdates: false,
    })
  })

  it('returns a 500 response when the summary query fails', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPrisma.clientNotification.count.mockRejectedValueOnce(
      new Error('Database exploded politely'),
    )

    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Database exploded politely',
    })

    errorSpy.mockRestore()
  })
})