// app/api/v1/waitlist/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  waitlistFindFirst: vi.fn(),
  waitlistCreate: vi.fn(),
  serviceFindUnique: vi.fn(),
  messageCreate: vi.fn(),
  messageThreadUpdate: vi.fn(),
  participantUpdate: vi.fn(),
  transaction: vi.fn(),
  resolveMessageThread: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waitlistEntry: {
      findFirst: mocks.waitlistFindFirst,
      create: mocks.waitlistCreate,
    },
    service: {
      findUnique: mocks.serviceFindUnique,
    },
    message: { create: mocks.messageCreate },
    messageThread: { update: mocks.messageThreadUpdate },
    messageThreadParticipant: { update: mocks.participantUpdate },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  pickString: (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null),
  pickInt: (v: unknown) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
  },
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, message: string) =>
    new Response(JSON.stringify({ ok: false, message }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/lib/messagesResolve', () => ({
  resolveMessageThread: mocks.resolveMessageThread,
}))

import { POST } from './route'

function postRequest(body: Record<string, unknown>): Request {
  return new Request('https://example.test/api/v1/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/waitlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client-1',
      user: { id: 'user-1' },
    })
    mocks.waitlistFindFirst.mockResolvedValue(null)
    mocks.waitlistCreate.mockResolvedValue({
      id: 'wl-1',
      status: 'ACTIVE',
      professionalId: 'pro-1',
      serviceId: 'svc-1',
      mediaId: null,
      notes: null,
      preferenceType: 'ANY_TIME',
      specificDate: null,
      timeOfDay: null,
      windowStartMin: null,
      windowEndMin: null,
    })
    mocks.serviceFindUnique.mockResolvedValue({ name: 'Balayage' })
    mocks.resolveMessageThread.mockResolvedValue({
      ok: true,
      thread: { id: 'thread-1' },
    })
    mocks.messageCreate.mockResolvedValue({
      id: 'msg-1',
      createdAt: new Date('2030-01-15T10:00:00.000Z'),
    })
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        message: { create: mocks.messageCreate },
        messageThread: { update: mocks.messageThreadUpdate },
        messageThreadParticipant: { update: mocks.participantUpdate },
      }),
    )
  })

  it('creates the entry AND seeds a WAITLIST thread with a first message', async () => {
    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.entry.id).toBe('wl-1')

    // Thread materialized for the new entry with createIfMissing.
    expect(mocks.resolveMessageThread).toHaveBeenCalledTimes(1)
    expect(mocks.resolveMessageThread).toHaveBeenCalledWith({
      viewer: { clientProfile: { id: 'client-1' } },
      input: {
        contextType: 'WAITLIST',
        contextId: 'wl-1',
        createIfMissing: true,
      },
    })

    // Seed message created as the client, and lastMessageAt set so it surfaces in the inbox.
    expect(mocks.messageCreate).toHaveBeenCalledTimes(1)
    expect(mocks.messageCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      threadId: 'thread-1',
      senderUserId: 'user-1',
    })
    expect(mocks.messageThreadUpdate.mock.calls[0]?.[0]?.data?.lastMessageAt).toBeTruthy()
  })

  it('still succeeds (201) when thread seeding throws — best-effort, never fails the join', async () => {
    mocks.resolveMessageThread.mockRejectedValue(new Error('messaging down'))

    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.entry.id).toBe('wl-1')
    expect(mocks.messageCreate).not.toHaveBeenCalled()
  })

  it('rejects a duplicate active waitlist request (409) and does not seed a thread', async () => {
    mocks.waitlistFindFirst.mockResolvedValue({ id: 'existing' })

    const res = await POST(
      postRequest({
        professionalId: 'pro-1',
        serviceId: 'svc-1',
        preferenceType: 'ANY_TIME',
      }),
    )

    expect(res.status).toBe(409)
    expect(mocks.waitlistCreate).not.toHaveBeenCalled()
    expect(mocks.resolveMessageThread).not.toHaveBeenCalled()
  })
})
