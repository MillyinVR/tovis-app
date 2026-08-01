// lib/messages/appendMessage.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const participantFindMany = vi.fn()
const broadcastLive = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageThreadParticipant: {
      findMany: (...args: unknown[]) => participantFindMany(...args),
    },
  },
}))

vi.mock('@/lib/live/broadcast', () => ({
  broadcastLive: (...args: unknown[]) => broadcastLive(...args),
  liveChannelForUser: (userId: string) => `user:${userId}`,
}))

import {
  ATTACHMENT_ONLY_PREVIEW,
  appendMessageToThread,
  broadcastThreadMessage,
  buildMessagePreview,
} from './appendMessage'

const CREATED_AT = new Date('2026-08-01T12:00:00.000Z')

function makeTx() {
  return {
    message: {
      create: vi.fn().mockResolvedValue({ id: 'msg_1', createdAt: CREATED_AT }),
    },
    messageThread: { update: vi.fn().mockResolvedValue({}) },
    messageThreadParticipant: { update: vi.fn().mockResolvedValue({}) },
  }
}

beforeEach(() => {
  participantFindMany.mockReset()
  broadcastLive.mockReset()
})

describe('buildMessagePreview', () => {
  it('uses the text', () => {
    expect(buildMessagePreview('hello', 0)).toBe('hello')
  })

  // The drift this extraction closes: the send route had this case, the
  // waitlist seed's `body.slice(0,140)` did not. An attachment-only message sent
  // through the second path would have shown a BLANK inbox row.
  it('labels an attachment-only message instead of leaving the row blank', () => {
    expect(buildMessagePreview(null, 1)).toBe(ATTACHMENT_ONLY_PREVIEW)
    expect(buildMessagePreview('   ', 1)).toBe(ATTACHMENT_ONLY_PREVIEW)
  })

  it('is empty when there is neither text nor an attachment', () => {
    expect(buildMessagePreview(null, 0)).toBe('')
  })

  it('truncates to the inbox row length', () => {
    expect(buildMessagePreview('x'.repeat(300), 0)).toHaveLength(140)
  })
})

describe('appendMessageToThread', () => {
  it('writes all THREE rows — message, thread pointers, sender read receipt', async () => {
    const tx = makeTx()

    await appendMessageToThread({
      tx: tx as never,
      threadId: 'thread_1',
      senderUserId: 'user_1',
      body: 'hi',
    })

    expect(tx.message.create).toHaveBeenCalledTimes(1)

    // 🔴 The inbox sorts and renders by lastMessageAt. A message that committed
    // without it is a message nobody ever sees.
    expect(tx.messageThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread_1' },
        data: { lastMessageAt: CREATED_AT, lastMessagePreview: 'hi' },
      }),
    )

    // The sender has, by definition, read what they just sent.
    expect(tx.messageThreadParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId_userId: { threadId: 'thread_1', userId: 'user_1' } },
        data: { lastReadAt: CREATED_AT },
      }),
    )
  })

  it('normalizes an empty body to null rather than storing ""', async () => {
    const tx = makeTx()

    await appendMessageToThread({
      tx: tx as never,
      threadId: 'thread_1',
      senderUserId: 'user_1',
      body: '',
      attachments: [
        { storageBucket: 'b', storagePath: 'p', mediaType: 'IMAGE' as never },
      ],
    })

    expect(tx.message.create.mock.calls[0]?.[0]?.data?.body).toBeNull()
  })

  it('creates attachment rows with the message', async () => {
    const tx = makeTx()

    await appendMessageToThread({
      tx: tx as never,
      threadId: 'thread_1',
      senderUserId: 'user_1',
      body: null,
      attachments: [
        { storageBucket: 'bucket', storagePath: 'a.jpg', mediaType: 'IMAGE' as never },
        { storageBucket: 'bucket', storagePath: 'b.jpg', mediaType: 'IMAGE' as never },
      ],
    })

    expect(tx.message.create.mock.calls[0]?.[0]?.data?.attachments?.create).toHaveLength(2)
    // …and the inbox row says so rather than going blank.
    expect(tx.messageThread.update.mock.calls[0]?.[0]?.data?.lastMessagePreview).toBe(
      ATTACHMENT_ONLY_PREVIEW,
    )
  })

  it('omits the attachments key entirely when there are none', async () => {
    const tx = makeTx()

    await appendMessageToThread({
      tx: tx as never,
      threadId: 'thread_1',
      senderUserId: 'user_1',
      body: 'hi',
    })

    expect(tx.message.create.mock.calls[0]?.[0]?.data).not.toHaveProperty('attachments')
  })
})

describe('broadcastThreadMessage', () => {
  it('pings every participant EXCEPT the sender', async () => {
    participantFindMany.mockResolvedValue([{ userId: 'user_2' }])
    broadcastLive.mockResolvedValue(undefined)

    await broadcastThreadMessage({ threadId: 'thread_1', senderUserId: 'user_1' })

    expect(participantFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { threadId: 'thread_1', userId: { not: 'user_1' } },
    })
    expect(broadcastLive).toHaveBeenCalledWith(['user:user_2'], 'messages')
  })
})
