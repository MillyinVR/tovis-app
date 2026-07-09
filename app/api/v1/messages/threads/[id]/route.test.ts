// app/api/v1/messages/threads/[id]/route.test.ts
//
// Route-level coverage for a single thread's message endpoint:
//   • GET  — cursor paging (validate-belongs-to-thread, skip/cursor wiring,
//            nextCursor/hasMore via the shared paging math) + membership guard.
//   • POST — attachment path validation (cross-thread + traversal rejected,
//            a valid thread-scoped path accepted) via the real
//            isMessageAttachmentPathForThread from lib/messages/attachments.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Role } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const jsonOk = vi.fn(
    (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const jsonFail = vi.fn(
    (status: number, message: string) =>
      new Response(JSON.stringify({ ok: false, error: message }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )

  const tx = {
    messageThread: { findUnique: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
    messageThreadParticipant: { update: vi.fn() },
  }

  const prisma = {
    messageThread: { findUnique: vi.fn() },
    message: { findFirst: vi.fn(), findMany: vi.fn() },
    messageThreadParticipant: { findMany: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  }

  return {
    jsonOk,
    jsonFail,
    prisma,
    tx,
    requireUser: vi.fn(),
    enforceRateLimit: vi.fn(),
    rateLimitIdentity: vi.fn(),
    pickString: vi.fn((v: string | null) => {
      if (typeof v !== 'string') return null
      const t = v.trim()
      return t.length > 0 ? t : null
    }),
    readJsonRecord: vi.fn(),
    broadcastLive: vi.fn(),
    liveChannelForUser: vi.fn((id: string) => `user:${id}`),
    kickNotificationDrain: vi.fn(),
    notifyNewMessageRecipients: vi.fn(),
    signMessageAttachmentUrls: vi.fn(async () => new Map<string, string>()),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

vi.mock('@/app/api/_utils/readJsonRecord', () => ({
  readJsonRecord: mocks.readJsonRecord,
}))

vi.mock('@/lib/live/broadcast', () => ({
  broadcastLive: mocks.broadcastLive,
  liveChannelForUser: mocks.liveChannelForUser,
}))

vi.mock('@/lib/notifications/delivery/kickNotificationDrain', () => ({
  kickNotificationDrain: mocks.kickNotificationDrain,
}))

vi.mock('@/lib/messages/notifyNewMessage', () => ({
  notifyNewMessageRecipients: mocks.notifyNewMessageRecipients,
}))

// Keep the REAL validators/constants (isMessageAttachmentPathForThread,
// MAX_MESSAGE_ATTACHMENTS, MESSAGE_ATTACHMENT_BUCKET); only stub the network
// signing call so no Supabase admin client is constructed.
vi.mock('@/lib/messages/attachments', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@/lib/messages/attachments')
  return {
    ...actual,
    signMessageAttachmentUrls: mocks.signMessageAttachmentUrls,
  }
})

import { GET, POST } from './route'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

function makeCtx(id = 'thread_1'): Ctx {
  return { params: { id } }
}

function makeAuth(id = 'user_1') {
  return { ok: true as const, user: { id, role: Role.CLIENT } }
}

function makeThread(overrides: Partial<{ participantUserIds: string[]; proUserId: string | null }> = {}) {
  const { participantUserIds = ['user_1', 'user_2'], proUserId = 'user_2' } = overrides
  return {
    id: 'thread_1',
    professional: proUserId ? { userId: proUserId } : null,
    participants: participantUserIds.map((userId) => ({ userId, lastReadAt: null })),
  }
}

function makeMessageRow(id: string) {
  return {
    id,
    body: `body ${id}`,
    createdAt: new Date('2026-07-08T12:00:00.000Z'),
    senderUserId: 'user_2',
    attachments: [],
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('messages thread [id] route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.enforceRateLimit.mockResolvedValue(undefined)
    mocks.rateLimitIdentity.mockResolvedValue('ident_1')
    mocks.prisma.messageThread.findUnique.mockResolvedValue(makeThread())
    mocks.prisma.message.findFirst.mockResolvedValue(null)
    mocks.prisma.message.findMany.mockResolvedValue([])
    mocks.prisma.messageThreadParticipant.findMany.mockResolvedValue([])
    mocks.broadcastLive.mockResolvedValue(undefined)
    mocks.notifyNewMessageRecipients.mockResolvedValue(undefined)
  })

  describe('GET (cursor paging)', () => {
    it('returns 404 when the thread does not exist', async () => {
      mocks.prisma.messageThread.findUnique.mockResolvedValue(null)

      const res = await GET(new Request('http://localhost/x'), makeCtx())

      expect(res.status).toBe(404)
      expect(mocks.prisma.message.findMany).not.toHaveBeenCalled()
    })

    it('returns 403 when the viewer is not a participant', async () => {
      mocks.prisma.messageThread.findUnique.mockResolvedValue(
        makeThread({ participantUserIds: ['user_2', 'user_3'] }),
      )

      const res = await GET(new Request('http://localhost/x'), makeCtx())

      expect(res.status).toBe(403)
      expect(mocks.prisma.message.findMany).not.toHaveBeenCalled()
    })

    it('ignores a cursor that does not belong to the thread (no skip/cursor)', async () => {
      // findFirst returns null → cursor treated as absent.
      mocks.prisma.message.findMany.mockResolvedValue([])

      await GET(
        new Request('http://localhost/x?cursor=foreign_msg'),
        makeCtx(),
      )

      expect(mocks.prisma.message.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign_msg', threadId: 'thread_1' },
        select: { id: true },
      })
      const arg = mocks.prisma.message.findMany.mock.calls[0]?.[0]
      expect(arg).not.toHaveProperty('cursor')
      expect(arg).not.toHaveProperty('skip')
    })

    it('pages from a valid cursor and returns ascending messages + nextCursor', async () => {
      mocks.prisma.message.findFirst.mockResolvedValue({ id: 'msg_3' })
      // DESC page of 2 (take=2) → full page → there is an older page.
      mocks.prisma.message.findMany.mockResolvedValue([
        makeMessageRow('msg_2'),
        makeMessageRow('msg_1'),
      ])

      const res = await GET(
        new Request('http://localhost/x?cursor=msg_3&take=2'),
        makeCtx(),
      )
      const body = await readJson(res)

      expect(res.status).toBe(200)

      const arg = mocks.prisma.message.findMany.mock.calls[0]?.[0]
      expect(arg.take).toBe(2)
      expect(arg.skip).toBe(1)
      expect(arg.cursor).toEqual({ id: 'msg_3' })
      expect(arg.orderBy).toEqual({ createdAt: 'desc' })

      // Reversed to ascending for display.
      const messages = body.messages as Array<{ id: string }>
      expect(messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2'])

      // Full page → cursor is the oldest id, hasMore true.
      expect(body.nextCursor).toBe('msg_1')
      expect(body.hasMore).toBe(true)
      expect(body.take).toBe(2)
    })

    it('returns hasMore=false on a partial (final) page', async () => {
      mocks.prisma.message.findMany.mockResolvedValue([makeMessageRow('msg_1')])

      const res = await GET(
        new Request('http://localhost/x?take=40'),
        makeCtx(),
      )
      const body = await readJson(res)

      expect(body.nextCursor).toBeNull()
      expect(body.hasMore).toBe(false)
    })
  })

  describe('POST (attachment validation)', () => {
    it('rejects a path scoped to another thread with 400 and never writes', async () => {
      mocks.readJsonRecord.mockResolvedValue({
        body: 'hi',
        attachments: ['messages/other_thread/user_1/2026-07/1_a.jpg'],
      })

      const res = await POST(
        new Request('http://localhost/x', { method: 'POST' }),
        makeCtx('thread_1'),
      )

      expect(res.status).toBe(400)
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects a traversal path with 400 and never writes', async () => {
      mocks.readJsonRecord.mockResolvedValue({
        attachments: ['messages/thread_1/../secret/1_a.jpg'],
      })

      const res = await POST(
        new Request('http://localhost/x', { method: 'POST' }),
        makeCtx('thread_1'),
      )

      expect(res.status).toBe(400)
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects a non-array attachments field with 400', async () => {
      mocks.readJsonRecord.mockResolvedValue({ attachments: 'nope' })

      const res = await POST(
        new Request('http://localhost/x', { method: 'POST' }),
        makeCtx('thread_1'),
      )

      expect(res.status).toBe(400)
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects more than the per-message attachment cap with 400', async () => {
      const paths = Array.from(
        { length: 7 },
        (_, i) => `messages/thread_1/user_1/2026-07/${i}_a.jpg`,
      )
      mocks.readJsonRecord.mockResolvedValue({ attachments: paths })

      const res = await POST(
        new Request('http://localhost/x', { method: 'POST' }),
        makeCtx('thread_1'),
      )

      expect(res.status).toBe(400)
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects an empty message (no text, no attachments) with 400', async () => {
      mocks.readJsonRecord.mockResolvedValue({ body: '   ' })

      const res = await POST(
        new Request('http://localhost/x', { method: 'POST' }),
        makeCtx('thread_1'),
      )

      expect(res.status).toBe(400)
      expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('accepts a valid thread-scoped attachment path and creates the message', async () => {
      const path = 'messages/thread_1/user_1/2026-07/1_a.jpg'
      mocks.readJsonRecord.mockResolvedValue({ body: 'here you go', attachments: [path] })

      mocks.tx.messageThread.findUnique.mockResolvedValue({
        id: 'thread_1',
        participants: [{ userId: 'user_1' }],
      })
      mocks.tx.message.create.mockResolvedValue({
        id: 'msg_new',
        body: 'here you go',
        createdAt: new Date('2026-07-08T12:00:00.000Z'),
        senderUserId: 'user_1',
        attachments: [],
      })
      mocks.tx.messageThread.update.mockResolvedValue({})
      mocks.tx.messageThreadParticipant.update.mockResolvedValue({})
      mocks.prisma.messageThreadParticipant.findMany.mockResolvedValue([
        { userId: 'user_2' },
      ])

      const res = await POST(
        new Request('http://localhost/x', { method: 'POST' }),
        makeCtx('thread_1'),
      )

      expect(res.status).toBe(200)
      expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1)

      const createArg = mocks.tx.message.create.mock.calls[0]?.[0]
      expect(createArg.data.attachments.create).toEqual([
        expect.objectContaining({ storagePath: path, mediaType: 'IMAGE' }),
      ])
      expect(mocks.notifyNewMessageRecipients).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: 'thread_1', senderUserId: 'user_1' }),
      )
    })
  })
})
