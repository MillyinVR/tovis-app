// app/api/v1/messages/threads/route.test.ts
//
// Route-level coverage for the inbox thread LIST endpoint: the filter tabs
// (All / Bookings / Waitlists / Pros) drive the Prisma `where`, and each row
// carries the server-computed context eyebrow + accent flag. The eyebrow logic
// is exercised through the REAL lib/messages/inboxContext (only Prisma is
// mocked) so this proves the route + shared resolver stay wired together.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageThreadContextType, ProNameDisplay, Role } from '@prisma/client'

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

  const prisma = {
    messageThread: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
    service: { findMany: vi.fn() },
    professionalServiceOffering: { findMany: vi.fn() },
    waitlistEntry: { findMany: vi.fn() },
  }

  return { jsonOk, jsonFail, prisma, requireUser: vi.fn() }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { GET } from './route'

function makeAuth(id = 'user_1') {
  return { ok: true as const, user: { id, role: Role.CLIENT } }
}

function makeThreadRow(
  overrides: Partial<{
    id: string
    contextType: MessageThreadContextType
    contextId: string
    bookingId: string | null
    serviceId: string | null
    offeringId: string | null
    waitlistEntryId: string | null
    professionalUserId: string
    professionalNameDisplay: ProNameDisplay
  }> = {},
) {
  const {
    id = 'thread_1',
    contextType = MessageThreadContextType.BOOKING,
    contextId = 'ctx_1',
    bookingId = 'booking_1',
    serviceId = null,
    offeringId = null,
    waitlistEntryId = null,
    professionalUserId = 'pro_user_1',
    professionalNameDisplay = ProNameDisplay.BUSINESS_NAME,
  } = overrides

  return {
    id,
    contextType,
    contextId,
    bookingId,
    serviceId,
    offeringId,
    waitlistEntryId,
    lastMessageAt: new Date('2026-07-08T12:00:00.000Z'),
    lastMessagePreview: 'See you then',
    updatedAt: new Date('2026-07-08T12:00:00.000Z'),
    client: {
      id: 'client_1',
      firstName: 'Tori',
      lastName: 'Morales',
      avatarUrl: null,
    },
    professional: {
      id: 'pro_1',
      userId: professionalUserId,
      businessName: 'Studio',
      firstName: 'Grace',
      lastName: 'Hopper',
      handle: 'studio',
      nameDisplay: professionalNameDisplay,
      avatarUrl: null,
    },
    participants: [{ lastReadAt: null }],
    _count: { messages: 3 },
  }
}

function makeRequest(query = ''): Request {
  return new Request(`http://localhost/api/v1/messages/threads${query}`)
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('GET /api/v1/messages/threads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(makeAuth())
    mocks.prisma.messageThread.findMany.mockResolvedValue([])
    mocks.prisma.booking.findMany.mockResolvedValue([])
    mocks.prisma.service.findMany.mockResolvedValue([])
    mocks.prisma.professionalServiceOffering.findMany.mockResolvedValue([])
    mocks.prisma.waitlistEntry.findMany.mockResolvedValue([])
  })

  it('returns the auth response immediately when requireUser fails', async () => {
    const authRes = new Response(JSON.stringify({ ok: false }), { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false as const, res: authRes })

    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    expect(mocks.prisma.messageThread.findMany).not.toHaveBeenCalled()
  })

  it('defaults to the "all" filter (no contextType constraint) and pages 50', async () => {
    await GET(makeRequest())

    const arg = mocks.prisma.messageThread.findMany.mock.calls[0]?.[0]
    expect(arg.take).toBe(50)
    expect(arg.where).toEqual({
      participants: { some: { userId: 'user_1' } },
      lastMessageAt: { not: null },
    })
  })

  it('constrains the where to BOOKING when filter=bookings', async () => {
    await GET(makeRequest('?filter=bookings'))

    const arg = mocks.prisma.messageThread.findMany.mock.calls[0]?.[0]
    expect(arg.where.contextType).toBe(MessageThreadContextType.BOOKING)
  })

  it('constrains the where to WAITLIST when filter=waitlists', async () => {
    await GET(makeRequest('?filter=waitlists'))

    const arg = mocks.prisma.messageThread.findMany.mock.calls[0]?.[0]
    expect(arg.where.contextType).toBe(MessageThreadContextType.WAITLIST)
  })

  it('constrains the where to the pro context types when filter=pros', async () => {
    await GET(makeRequest('?filter=pros'))

    const arg = mocks.prisma.messageThread.findMany.mock.calls[0]?.[0]
    expect(arg.where.contextType).toEqual({
      in: [
        MessageThreadContextType.PRO_PROFILE,
        MessageThreadContextType.SERVICE,
        MessageThreadContextType.OFFERING,
      ],
    })
  })

  it('attaches the accent-tinted booking eyebrow and derives isViewerPro', async () => {
    // Viewer is the thread's professional → isViewerPro true.
    mocks.prisma.messageThread.findMany.mockResolvedValue([
      makeThreadRow({ professionalUserId: 'user_1' }),
    ])
    mocks.prisma.booking.findMany.mockResolvedValue([
      {
        id: 'booking_1',
        scheduledFor: new Date('2026-07-10T21:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        service: { name: 'Balayage' },
      },
    ])

    const res = await GET(makeRequest('?filter=bookings'))
    const body = await readJson(res)
    const threads = body.threads as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(mocks.prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['booking_1'] } } }),
    )
    expect(threads).toHaveLength(1)
    expect(threads[0]?.isViewerPro).toBe(true)
    expect(threads[0]?.isAccentContext).toBe(true)
    expect(threads[0]?.eyebrow).toContain('BOOKING CONFIRMED')
    expect(threads[0]?.eyebrow).toContain('Balayage')
    // The professional payload never leaks the counterparty's user id nor the
    // raw first/last names selected only to resolve the display name.
    expect(threads[0]?.professional).not.toHaveProperty('userId')
    expect(threads[0]?.professional).not.toHaveProperty('firstName')
    expect(threads[0]?.professional).not.toHaveProperty('lastName')
    // Server-resolved display name (BUSINESS_NAME toggle → business name).
    expect(threads[0]?.professional).toMatchObject({ displayName: 'Studio' })
  })

  it('resolves the professional displayName from the nameDisplay toggle (HANDLE → @handle)', async () => {
    mocks.prisma.messageThread.findMany.mockResolvedValue([
      makeThreadRow({ professionalNameDisplay: ProNameDisplay.HANDLE }),
    ])
    mocks.prisma.booking.findMany.mockResolvedValue([
      {
        id: 'booking_1',
        scheduledFor: new Date('2026-07-10T21:00:00.000Z'),
        locationTimeZone: 'America/Los_Angeles',
        service: { name: 'Balayage' },
      },
    ])

    const res = await GET(makeRequest('?filter=bookings'))
    const body = await readJson(res)
    const threads = body.threads as Array<Record<string, unknown>>

    expect(threads[0]?.professional).toMatchObject({ displayName: '@studio' })
    expect(threads[0]?.professional).not.toHaveProperty('firstName')
    expect(threads[0]?.professional).not.toHaveProperty('lastName')
  })

  it('marks a non-accent pro-profile eyebrow and isViewerPro false for a client viewer', async () => {
    mocks.prisma.messageThread.findMany.mockResolvedValue([
      makeThreadRow({
        contextType: MessageThreadContextType.PRO_PROFILE,
        bookingId: null,
        professionalUserId: 'pro_user_1',
      }),
    ])

    const res = await GET(makeRequest('?filter=pros'))
    const body = await readJson(res)
    const threads = body.threads as Array<Record<string, unknown>>

    expect(threads[0]?.isViewerPro).toBe(false)
    expect(threads[0]?.isAccentContext).toBe(false)
    expect(threads[0]?.eyebrow).toBe('Pro')
  })

  it('returns 500 when the query throws', async () => {
    mocks.prisma.messageThread.findMany.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const res = await GET(makeRequest())

    expect(res.status).toBe(500)
    errorSpy.mockRestore()
  })
})
