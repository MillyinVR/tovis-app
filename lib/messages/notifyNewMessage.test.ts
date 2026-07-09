import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationEventKey, Role } from '@prisma/client'

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockCreateClientNotification = vi.hoisted(() => vi.fn())
const mockCreateProNotification = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: { messageThread: { findUnique: mockFindUnique } },
}))
vi.mock('@/lib/notifications/clientNotifications', () => ({
  createClientNotification: mockCreateClientNotification,
}))
vi.mock('@/lib/notifications/proNotifications', () => ({
  createProNotification: mockCreateProNotification,
}))

import {
  buildMessageNotificationDedupeKey,
  messageThreadHref,
  notifyNewMessageRecipients,
} from './notifyNewMessage'

const PRO_USER = 'user_pro'
const CLIENT_USER = 'user_client'

const THREAD = {
  id: 'thr_1',
  clientId: 'cli_1',
  professionalId: 'pro_1',
  participants: [
    { userId: PRO_USER, role: Role.PRO },
    { userId: CLIENT_USER, role: Role.CLIENT },
  ],
  client: { firstName: 'Dana', lastName: 'Rivers', avatarUrl: null },
  professional: {
    businessName: 'Glow Studio',
    firstName: 'Sam',
    lastName: 'Lee',
    avatarUrl: null,
  },
}

describe('lib/messages/notifyNewMessage', () => {
  beforeEach(() => {
    mockFindUnique.mockReset()
    mockCreateClientNotification.mockReset()
    mockCreateProNotification.mockReset()
    mockFindUnique.mockResolvedValue(THREAD)
    mockCreateClientNotification.mockResolvedValue({ id: 'n_c' })
    mockCreateProNotification.mockResolvedValue({ id: 'n_p' })
  })

  it('builds the thread deep-link href', () => {
    expect(messageThreadHref('thr_1')).toBe('/messages/thread/thr_1')
  })

  it('windows the dedupe key so a burst coalesces but the next window does not', () => {
    const t0 = new Date('2026-07-15T12:00:00.000Z')
    const sameWindow = new Date('2026-07-15T12:01:30.000Z')
    const nextWindow = new Date('2026-07-15T12:03:00.000Z')

    const k0 = buildMessageNotificationDedupeKey('thr_1', t0)
    expect(buildMessageNotificationDedupeKey('thr_1', sameWindow)).toBe(k0)
    expect(buildMessageNotificationDedupeKey('thr_1', nextWindow)).not.toBe(k0)
  })

  it('notifies the CLIENT recipient when the PRO sends, titled with the pro name', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    await notifyNewMessageRecipients({
      threadId: 'thr_1',
      senderUserId: PRO_USER,
      preview: 'See you at 3',
      now,
    })

    expect(mockCreateProNotification).not.toHaveBeenCalled()
    expect(mockCreateClientNotification).toHaveBeenCalledWith({
      clientId: 'cli_1',
      eventKey: NotificationEventKey.MESSAGE_RECEIVED,
      title: 'New message from Glow Studio',
      body: 'See you at 3',
      href: '/messages/thread/thr_1',
      dedupeKey: buildMessageNotificationDedupeKey('thr_1', now),
    })
  })

  it('notifies the PRO recipient when the CLIENT sends, titled with the client name + carries actorUserId', async () => {
    await notifyNewMessageRecipients({
      threadId: 'thr_1',
      senderUserId: CLIENT_USER,
      preview: 'Running late',
    })

    expect(mockCreateClientNotification).not.toHaveBeenCalled()
    expect(mockCreateProNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        professionalId: 'pro_1',
        eventKey: NotificationEventKey.MESSAGE_RECEIVED,
        title: 'New message from Dana Rivers',
        body: 'Running late',
        href: '/messages/thread/thr_1',
        actorUserId: CLIENT_USER,
      }),
    )
  })

  it('falls back to a generic preview when the message is attachment-only/blank', async () => {
    await notifyNewMessageRecipients({
      threadId: 'thr_1',
      senderUserId: PRO_USER,
      preview: '   ',
    })

    expect(mockCreateClientNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Sent you a message' }),
    )
  })

  it('no-ops when the thread is missing', async () => {
    mockFindUnique.mockResolvedValue(null)
    await notifyNewMessageRecipients({
      threadId: 'nope',
      senderUserId: PRO_USER,
      preview: 'hi',
    })
    expect(mockCreateClientNotification).not.toHaveBeenCalled()
    expect(mockCreateProNotification).not.toHaveBeenCalled()
  })
})
