import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey } from '@prisma/client'

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
          eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
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
      eventKey: null,
    })

    expect(jsonOk).toHaveBeenCalledWith(
      {
        items: [
          {
            id: 'notif_1',
            eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
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
            eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
            title: 'New booking request',
          },
        ],
        nextCursor: null,
      },
    })
  })

  it('passes cursor, unread filter, and eventKey filter through', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValueOnce({
      items: [],
      nextCursor: 'notif_next',
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?take=25&cursor=notif_cursor&unread=1&eventKey=REVIEW_RECEIVED',
    )

    await GET(req)

    expect(listProNotifications).toHaveBeenCalledWith({
      professionalId: 'pro_123',
      take: 25,
      cursorId: 'notif_cursor',
      unreadOnly: true,
      eventKey: NotificationEventKey.REVIEW_RECEIVED,
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
      eventKey: null,
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
      eventKey: null,
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
      eventKey: null,
    })
  })

  it('returns 400 when eventKey is invalid', async () => {
    requirePro.mockResolvedValueOnce({
      ok: true,
      professionalId: 'pro_123',
    })

    const req = new Request(
      'http://localhost/api/pro/notifications?eventKey=totally_wrong',
    )

    const result = await GET(req)

    expect(jsonFail).toHaveBeenCalledWith(
      400,
      'Invalid notification event key.',
    )
    expect(listProNotifications).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 400,
      body: { ok: false, error: 'Invalid notification event key.' },
    })
  })

  it('accepts representative supported notification event keys', async () => {
    requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_123',
    })

    listProNotifications.mockResolvedValue({
      items: [],
      nextCursor: null,
    })

    const supportedEventKeys = [
      NotificationEventKey.BOOKING_REQUEST_CREATED,
      NotificationEventKey.BOOKING_CONFIRMED,
      NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
      NotificationEventKey.REVIEW_RECEIVED,
    ]

    for (const eventKey of supportedEventKeys) {
      await GET(
        new Request(
          `http://localhost/api/pro/notifications?eventKey=${eventKey}`,
        ),
      )
    }

    expect(listProNotifications).toHaveBeenCalledTimes(4)
    expect(listProNotifications).toHaveBeenNthCalledWith(1, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      eventKey: NotificationEventKey.BOOKING_REQUEST_CREATED,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(2, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      eventKey: NotificationEventKey.BOOKING_CONFIRMED,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(3, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      eventKey: NotificationEventKey.BOOKING_CANCELLED_BY_CLIENT,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(4, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: false,
      eventKey: NotificationEventKey.REVIEW_RECEIVED,
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
      eventKey: null,
    })
    expect(listProNotifications).toHaveBeenNthCalledWith(2, {
      professionalId: 'pro_123',
      take: 60,
      cursorId: null,
      unreadOnly: true,
      eventKey: null,
    })
  })
})