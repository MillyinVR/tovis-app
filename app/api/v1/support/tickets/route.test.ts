import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  createSupportTicket: vi.fn(),
  serializeSupportTicket: vi.fn(),
  safeError: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
}))

vi.mock('@/lib/support/createSupportTicket', () => ({
  createSupportTicket: mocks.createSupportTicket,
}))

vi.mock('@/lib/dto/supportTicket', () => ({
  serializeSupportTicket: mocks.serializeSupportTicket,
}))

vi.mock('@/lib/security/logging', () => ({
  safeError: mocks.safeError,
}))

import { POST } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeRequest(body: unknown): Request {
  return new Request('https://app.tovis.app/api/v1/support/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/support/tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: { id: 'user_1', role: 'CLIENT' },
    })
    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.rateLimitIdentity.mockResolvedValue({ kind: 'user', id: 'user_1' })
    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )
    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: Record<string, unknown>) =>
        makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )
    mocks.createSupportTicket.mockResolvedValue({
      ok: true,
      ticket: {
        id: 'tkt_1',
        subject: 'Booking not confirming',
        status: 'OPEN',
        createdAt: new Date('2026-07-16T00:00:00.000Z'),
      },
    })
    mocks.serializeSupportTicket.mockImplementation((row: { id: string }) => ({
      id: row.id,
      subject: 'Booking not confirming',
      status: 'OPEN',
      createdAt: '2026-07-16T00:00:00.000Z',
    }))
  })

  it('returns the auth response when unauthenticated', async () => {
    const denied = makeJsonResponse(401, { ok: false })
    mocks.requireUser.mockResolvedValue({ ok: false, res: denied })

    const res = await POST(makeRequest({ subject: 's', message: 'm' }))

    expect(res.status).toBe(401)
    expect(mocks.createSupportTicket).not.toHaveBeenCalled()
  })

  it('files the ticket against the authed user and their acting role', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: { id: 'user_7', role: 'PRO' },
    })

    const res = await POST(
      makeRequest({ subject: 'Booking not confirming', message: 'It spins forever.' }),
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    // The whole point of the route: the ticket carries a real user, so
    // /admin/support has someone to reply to.
    expect(mocks.createSupportTicket).toHaveBeenCalledWith({
      author: { id: 'user_7', role: 'PRO' },
      subject: 'Booking not confirming',
      message: 'It spins forever.',
    })
    expect(body.ticket.id).toBe('tkt_1')
  })

  it('surfaces the writer validation code as a 400', async () => {
    mocks.createSupportTicket.mockResolvedValue({
      ok: false,
      error: { code: 'MISSING_FIELDS', message: 'Subject and message are required.' },
    })

    const res = await POST(makeRequest({ subject: '   ' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('MISSING_FIELDS')
  })

  it('returns the rate-limit response without writing', async () => {
    mocks.enforceRateLimit.mockResolvedValue(
      makeJsonResponse(429, { ok: false, code: 'RATE_LIMITED' }),
    )

    const res = await POST(makeRequest({ subject: 's', message: 'm' }))

    expect(res.status).toBe(429)
    expect(mocks.createSupportTicket).not.toHaveBeenCalled()
    // Keyed per user, so one account can't flood the admin queue.
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith({
      bucket: 'support:tickets:create',
      identity: { kind: 'user', id: 'user_1' },
    })
  })

  it('500s without leaking the underlying error', async () => {
    mocks.createSupportTicket.mockRejectedValue(new Error('db exploded: secret dsn'))

    const res = await POST(makeRequest({ subject: 's', message: 'm' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('secret dsn')
  })
})
