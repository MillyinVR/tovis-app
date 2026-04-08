import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

const mockRequireClient = vi.hoisted(() => vi.fn())
const mockMarkClientNotificationsRead = vi.hoisted(() => vi.fn())

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/notifications/clientNotifications', () => ({
  markClientNotificationsRead: mockMarkClientNotificationsRead,
}))

import { POST } from './route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/client/notifications/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/client/notifications/read', () => {
  beforeEach(() => {
    mockRequireClient.mockReset()
    mockMarkClientNotificationsRead.mockReset()
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

    const response = await POST(makeRequest({ ids: ['notif_1'] }))

    expect(response).toBe(unauthorizedResponse)
    expect(mockMarkClientNotificationsRead).not.toHaveBeenCalled()
  })

  it('returns 400 when the request body is not an object', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const response = await POST(makeRequest(['not-an-object']))
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid request body.',
    })
    expect(mockMarkClientNotificationsRead).not.toHaveBeenCalled()
  })

  it('marks selected notifications read by ids', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 2 })

    const response = await POST(
      makeRequest({
        ids: ['notif_1', ' notif_2 ', '', '   '],
      }),
    )
    const json = await response.json()

    expect(mockMarkClientNotificationsRead).toHaveBeenCalledWith({
      clientId: 'client_1',
      ids: ['notif_1', 'notif_2'],
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      count: 2,
    })
  })

  it('marks notifications read by before date and single event key', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 3 })

    const response = await POST(
      makeRequest({
        before: '2026-04-06T12:00:00.000Z',
        eventKey: NotificationEventKey.AFTERCARE_READY,
      }),
    )
    const json = await response.json()

    expect(mockMarkClientNotificationsRead).toHaveBeenCalledWith({
      clientId: 'client_1',
      before: new Date('2026-04-06T12:00:00.000Z'),
      eventKeys: [NotificationEventKey.AFTERCARE_READY],
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      count: 3,
    })
  })

  it('marks notifications read by multiple deduped event keys', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 4 })

    const response = await POST(
      makeRequest({
        eventKeys: [
          NotificationEventKey.BOOKING_CONFIRMED,
          NotificationEventKey.BOOKING_RESCHEDULED,
          NotificationEventKey.BOOKING_CONFIRMED,
        ],
      }),
    )
    const json = await response.json()

    expect(mockMarkClientNotificationsRead).toHaveBeenCalledWith({
      clientId: 'client_1',
      eventKeys: [
        NotificationEventKey.BOOKING_CONFIRMED,
        NotificationEventKey.BOOKING_RESCHEDULED,
      ],
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      count: 4,
    })
  })

  it('returns 400 for an invalid single notification event key', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const response = await POST(
      makeRequest({
        eventKey: 'NOT_A_REAL_EVENT_KEY',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid notification event key.',
    })
    expect(mockMarkClientNotificationsRead).not.toHaveBeenCalled()
  })

  it('returns 400 when eventKeys is not an array', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const response = await POST(
      makeRequest({
        eventKeys: 'NOT_AN_ARRAY',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid notification event keys.',
    })
    expect(mockMarkClientNotificationsRead).not.toHaveBeenCalled()
  })

  it('ignores invalid entries inside an eventKeys array and falls back to no event key filter when none survive', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 5 })

    const response = await POST(
      makeRequest({
        eventKeys: ['NOT_REAL', 'ALSO_NOT_REAL'],
      }),
    )
    const json = await response.json()

    expect(mockMarkClientNotificationsRead).toHaveBeenCalledWith({
      clientId: 'client_1',
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      count: 5,
    })
  })

  it('returns 500 when marking notifications read throws', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockMarkClientNotificationsRead.mockRejectedValueOnce(
      new Error('Read path exploded'),
    )

    const response = await POST(makeRequest({ ids: ['notif_1'] }))
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({
      ok: false,
      error: 'Read path exploded',
    })

    errorSpy.mockRestore()
  })
})