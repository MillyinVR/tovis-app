// app/api/v1/messages/resolve/route.test.ts
//
// Route-level coverage for find-or-create thread resolution, focused on the
// thing that was broken: the response must carry the WHOLE thread row, not just
// its id.
//
// A freshly created thread has no messages, and the inbox deliberately hides
// message-less threads (`whereForInboxFilter` filters `lastMessageAt: not
// null`). iOS resolved a thread and then hunted for it in the inbox list, so
// the very first message to a client opened nothing at all. Returning the row
// here is what makes that one round trip sufficient.
//
// Only Prisma is mocked — the real lib/messages/threadRow and
// lib/messages/inboxContext run, so this proves the route and the shared
// serializer stay wired together (the same approach the list route test takes).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageThreadContextType, ProNameDisplay, Role } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const prisma = {
    messageThread: { findUnique: vi.fn() },
    booking: { findMany: vi.fn() },
    service: { findMany: vi.fn() },
    professionalServiceOffering: { findMany: vi.fn() },
    waitlistEntry: { findMany: vi.fn() },
  }

  return {
    prisma,
    requireUser: vi.fn(),
    resolveMessageThread: vi.fn(),
  }
})

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))

vi.mock('@/lib/messagesResolve', () => ({
  resolveMessageThread: mocks.resolveMessageThread,
}))

import { POST } from './route'

const VIEWER_ID = 'pro_user_1'

function makeAuth(id = VIEWER_ID) {
  return { ok: true as const, user: { id, role: Role.PRO } }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/messages/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * A thread row as Prisma returns it. Defaults to the shape that used to be
 * invisible: no messages, no `lastMessageAt`.
 */
function makeThreadRow(
  overrides: Partial<{ professionalUserId: string; lastMessageAt: Date | null }> = {},
) {
  const { professionalUserId = VIEWER_ID, lastMessageAt = null } = overrides

  return {
    id: 'thread_1',
    contextType: MessageThreadContextType.BOOKING,
    contextId: 'booking_1',
    bookingId: 'booking_1',
    serviceId: null,
    offeringId: null,
    waitlistEntryId: null,
    lastMessageAt,
    lastMessagePreview: null,
    updatedAt: new Date('2026-07-18T23:41:56.721Z'),
    client: {
      id: 'client_1',
      firstName: 'Test',
      lastName: 'Client',
      avatarUrl: null,
    },
    professional: {
      id: 'pro_1',
      userId: professionalUserId,
      businessName: 'TOVIS Test Pro',
      firstName: 'Grace',
      lastName: 'Hopper',
      handle: 'studio',
      nameDisplay: ProNameDisplay.BUSINESS_NAME,
      avatarUrl: null,
    },
    participants: [{ lastReadAt: null }],
    _count: { messages: 0 },
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

/** Narrow the `thread` field without a cast (house rule: no type escapes). */
function threadOf(body: Record<string, unknown>): Record<string, unknown> | null {
  const thread = body.thread
  if (thread === null) return null
  if (typeof thread !== 'object' || thread === undefined) {
    throw new Error(`expected an object thread, got ${String(thread)}`)
  }
  return Object.fromEntries(Object.entries(thread))
}

const BOOKING_BODY = {
  contextType: 'BOOKING',
  contextId: 'booking_1',
  createIfMissing: true,
}

describe('POST /api/v1/messages/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.resolveMessageThread.mockResolvedValue({
      ok: true,
      thread: { id: 'thread_1' },
    })
    mocks.prisma.messageThread.findUnique.mockResolvedValue(makeThreadRow())
    mocks.prisma.booking.findMany.mockResolvedValue([])
    mocks.prisma.service.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.waitlistEntry.findMany.mockResolvedValue([])
  })

  it('returns the auth response immediately when requireUser fails', async () => {
    const authRes = new Response(JSON.stringify({ ok: false }), { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false as const, res: authRes })

    const res = await POST(makeRequest(BOOKING_BODY))

    expect(res.status).toBe(401)
    expect(mocks.resolveMessageThread).not.toHaveBeenCalled()
  })

  it('400s without a usable contextType/contextId', async () => {
    const res = await POST(makeRequest({ contextType: 'NOPE', contextId: 'x' }))

    expect(res.status).toBe(400)
    expect(mocks.resolveMessageThread).not.toHaveBeenCalled()
  })

  // THE REGRESSION TEST. A thread with zero messages is precisely the one the
  // inbox hides, so an id-only response left the caller unable to open it.
  it('returns the full thread row for a brand-new, message-less thread', async () => {
    const res = await POST(makeRequest(BOOKING_BODY))
    const thread = threadOf(await readJson(res))

    expect(res.status).toBe(200)
    expect(thread).toMatchObject({
      id: 'thread_1',
      contextType: MessageThreadContextType.BOOKING,
      bookingId: 'booking_1',
      // The fields that make it invisible to the inbox — present all the same.
      lastMessageAt: null,
      lastMessagePreview: null,
      _count: { messages: 0 },
      // Everything the thread view needs to render its header:
      client: { id: 'client_1', firstName: 'Test', lastName: 'Client' },
      professional: { id: 'pro_1', displayName: 'TOVIS Test Pro' },
      participants: [{ lastReadAt: null }],
      isViewerPro: true,
      eyebrow: 'BOOKING CONFIRMED',
      isAccentContext: true,
    })
  })

  it('scopes the row to the viewer — participants filter and isViewerPro', async () => {
    mocks.prisma.messageThread.findUnique.mockResolvedValue(
      makeThreadRow({ professionalUserId: 'somebody_else' }),
    )

    const res = await POST(makeRequest(BOOKING_BODY))
    const thread = threadOf(await readJson(res))

    // Viewer is not this thread's pro, so the counterparty is the pro.
    expect(thread?.isViewerPro).toBe(false)

    const findArg = mocks.prisma.messageThread.findUnique.mock.calls[0]?.[0]
    expect(findArg.where).toEqual({ id: 'thread_1' })
    expect(findArg.select.participants.where).toEqual({ userId: VIEWER_ID })
  })

  it('never places the professional’s raw first/last name on the wire', async () => {
    const res = await POST(makeRequest(BOOKING_BODY))
    const body = await res.text()

    // Only the resolved displayName is emitted (the raw names are selected
    // purely to resolve the pro's nameDisplay toggle).
    expect(body).toContain('TOVIS Test Pro')
    expect(body).not.toContain('Grace')
    expect(body).not.toContain('Hopper')
  })

  it('returns thread:null without loading a row when nothing resolved', async () => {
    mocks.resolveMessageThread.mockResolvedValue({ ok: true, thread: null })

    const res = await POST(
      makeRequest({ ...BOOKING_BODY, createIfMissing: false }),
    )

    expect(res.status).toBe(200)
    expect(threadOf(await readJson(res))).toBeNull()
    expect(mocks.prisma.messageThread.findUnique).not.toHaveBeenCalled()
  })

  it('passes a refusal through with its code — e.g. an unclaimed client', async () => {
    mocks.resolveMessageThread.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Client account has not been claimed yet.',
      details: { code: 'CLIENT_UNCLAIMED' },
    })

    const res = await POST(makeRequest(BOOKING_BODY))
    const body = await readJson(res)

    expect(res.status).toBe(409)
    expect(body.code).toBe('CLIENT_UNCLAIMED')
    expect(mocks.prisma.messageThread.findUnique).not.toHaveBeenCalled()
  })

  it('500s rather than reporting "no thread" when the resolved row vanishes', async () => {
    // Nothing in the app deletes threads, so a miss here is an invariant
    // violation. Answering thread:null would disguise it as "nothing resolved"
    // and the caller would show a benign empty state over a real fault.
    mocks.prisma.messageThread.findUnique.mockResolvedValue(null)

    const res = await POST(makeRequest(BOOKING_BODY))

    expect(res.status).toBe(500)
    expect(await readJson(res)).not.toHaveProperty('thread')
  })
})
