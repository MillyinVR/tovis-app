import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationType } from '@prisma/client'

const requirePro = vi.fn()
const jsonOk = vi.fn((body: unknown, status: number) => ({
  status,
  body,
}))
const jsonFail = vi.fn((status: number, error: string) => ({
  status,
  body: { ok: false, error },
}))

const listProNotifications = vi.fn()

vi.mock('@/app/api/_utils', () => ({
  requirePro,
  jsonOk,
  jsonFail,
}))

vi.mock('@/lib/notifications/proNotificationQueries', () => ({
  listProNotifications,
}))

import { GET } from '@/app/api/pro/notifications/route'

describe('GET /api/pro/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = {
      status: 401,
      body: { ok: false, error: 'Unauthorized' },
    }

    requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const req = new Request('http://localhost/api/pro/notifications')
    const result = await GET(req)

    expect(result).toBe(authRes)
    expect(listProNotifications).not.toHaveBeenCalled()
  })

  it('returns the first page with default take', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValueOnce({
      items: [
        {
          id: 'notif_1',
          type: NotificationType.BOOKING_REQUEST,
          title: 'New booking request',
        },
      ],
      nextCursor: null,
    })

    const req = new Request('http://localhost/api/pro/notifications')
    const result = await GET(req)

    expect(listProNotifications).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      type: null,
    })

    expect(jsonOk).toHaveBeenCalledWith(
      {
        items: [
          {
            id: 'notif_1',
            type: NotificationType.BOOKING_REQUEST,
            title: 'New booking request',
          },
        ],
        nextCursor: null,
      },
      200,
    )

    expect(result).toEqual({
      status: 200,
      body: {
        items: [
          {
            id: 'notif_1',
            type: NotificationType.BOOKING_REQUEST,
            title: 'New booking request',
          },
        ],
        nextCursor: null,
      },
    })
  })

  it('passes cursor, unread filter, and type filter through', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValueOnce({
      items: [],
      nextCursor: 'notif_next',
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?take=25&cursor=notif_cursor&unread=1&type=REVIEW',
    )

    await GET(req)

    expect(listProNotifications).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      take: 25,
      cursorId: 'notif_cursor',
      unreadOnly: true,
      type: NotificationType.REVIEW,
    })
  })

  it('clamps take to the maximum of 100', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?take=999',
    )

    await GET(req)

    expect(listProNotifications).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      take: 100,
      cursorId: null,
      unreadOnly: false,
      type: null,
    })
  })

  it('clamps take to the minimum of 1', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?take=0',
    )

    await GET(req)

    expect(listProNotifications).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      take: 1,
      cursorId: null,
      unreadOnly: false,
      type: null,
    })
  })

  it('uses fallback take when take is invalid', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?take=not-a-number',
    )

    await GET(req)

    expect(listProNotifications).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      type: null,
    })
  })

  it('returns 400 when type is invalid', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?type=totally_wrong',
    )

    const result = await GET(req)

    expect(jsonFail).toHaveBeenCalledWith(400, 'Invalid notification type.')
    expect(listProNotifications).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 400,
      body: { ok: false, error: 'Invalid notification type.' },
    })
  })

  it('accepts each supported notification type', async () => {
    requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValue({
      items: [],
      nextCursor: null,
    })

    const supportedTypes = [
      'BOOKING_REQUEST',
      'BOOKING_UPDATE',
      'BOOKING_CANCELLED',
      'REVIEW',
    ]

    for (const type of supportedTypes) {
      await GET(
        new Request(`http://localhost/api/pro/notifications?type=${type}`),
      )
    }

    expect(listProNotifications).toHaveBeenCalledTimes(4)
    expect(listProNotifications).toHaveBeenNthCalledWith(1, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      type: NotificationType.BOOKING_REQUEST,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(2, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      type: NotificationType.BOOKING_UPDATE,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(3, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      type: NotificationType.BOOKING_CANCELLED,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(4, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      type: NotificationType.REVIEW,
    })
  })

  it('treats unread=true and unread=yes as unreadOnly', async () => {
    requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValue({
      items: [],
      nextCursor: null,
    })

    await GET(
      new Request('http://localhost/api/pro/notifications?unread=true'),
    )
    await GET(
      new Request('http://localhost/api/pro/notifications?unread=yes'),
    )

    expect(listProNotifications).toHaveBeenNthCalledWith(1, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: true,
      type: null,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(2, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: true,
      type: null,
    })
  })
})