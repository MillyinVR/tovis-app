import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientNotificationType } from '@prisma/client'

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

  it('marks notifications read by before date and single type', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 3 })

    const response = await POST(
      makeRequest({
        before: '2026-04-06T12:00:00.000Z',
        type: ClientNotificationType.AFTERCARE,
      }),
    )
    const json = await response.json()

    expect(mockMarkClientNotificationsRead).toHaveBeenCalledWith({
      clientId: 'client_1',
      before: new Date('2026-04-06T12:00:00.000Z'),
      types: [ClientNotificationType.AFTERCARE],
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      count: 3,
    })
  })

  it('marks notifications read by multiple deduped types', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 4 })

    const response = await POST(
      makeRequest({
        types: [
          ClientNotificationType.BOOKING_CONFIRMED,
          ClientNotificationType.BOOKING_RESCHEDULED,
          ClientNotificationType.BOOKING_CONFIRMED,
        ],
      }),
    )
    const json = await response.json()

    expect(mockMarkClientNotificationsRead).toHaveBeenCalledWith({
      clientId: 'client_1',
      types: [
        ClientNotificationType.BOOKING_CONFIRMED,
        ClientNotificationType.BOOKING_RESCHEDULED,
      ],
    })

    expect(response.status).toBe(200)
    expect(json).toEqual({
      ok: true,
      count: 4,
    })
  })

  it('returns 400 for an invalid single notification type', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const response = await POST(
      makeRequest({
        type: 'NOT_A_REAL_TYPE',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid notification type.',
    })
    expect(mockMarkClientNotificationsRead).not.toHaveBeenCalled()
  })

  it('returns 400 when types is not an array', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    const response = await POST(
      makeRequest({
        types: 'NOT_AN_ARRAY',
      }),
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json).toEqual({
      ok: false,
      error: 'Invalid notification types.',
    })
    expect(mockMarkClientNotificationsRead).not.toHaveBeenCalled()
  })

  it('ignores invalid entries inside a types array and falls back to no type filter when none survive', async () => {
    mockRequireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
    })

    mockMarkClientNotificationsRead.mockResolvedValue({ count: 5 })

    const response = await POST(
      makeRequest({
        types: ['NOT_REAL', 'ALSO_NOT_REAL'],
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