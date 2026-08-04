// app/api/v1/me/account-deletion/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadAccountDeletionStatus: vi.fn(),
  requestAccountDeletion: vi.fn(),
  cancelAccountDeletion: vi.fn(),
}))

vi.mock('@/app/api/_utils/responses', () => ({
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...(data as object) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, error: string, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/privacy/accountDeletion', () => ({
  loadAccountDeletionStatus: mocks.loadAccountDeletionStatus,
  requestAccountDeletion: mocks.requestAccountDeletion,
  cancelAccountDeletion: mocks.cancelAccountDeletion,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { DELETE, GET, POST } from './route'

const REQUEST_VIEW = {
  id: 'adr_1',
  status: 'PENDING',
  requestedAt: '2026-08-04T00:00:00.000Z',
  scheduledFor: '2026-08-18T00:00:00.000Z',
}

function post(body: unknown) {
  return POST(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'user_1' } })
})

describe('GET /api/v1/me/account-deletion', () => {
  it('refuses an unauthenticated caller without reading any state', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: new Response('nope', { status: 401 }),
    })

    const res = await GET()

    expect(res.status).toBe(401)
    expect(mocks.loadAccountDeletionStatus).not.toHaveBeenCalled()
  })

  it('stays reachable from a session that is not fully verified', async () => {
    // requireUser() defaults to refusing an unverified session. Applied here
    // that would mean someone who signed up, never finished verification, and
    // wants their data gone cannot delete their own account — a direct failure
    // of App Store guideline 5.1.1(v).
    await GET()

    expect(mocks.requireUser).toHaveBeenCalledWith(
      expect.objectContaining({ allowVerificationSession: true }),
    )
  })

  it('returns the status for the CALLER, never an id from the request', async () => {
    mocks.loadAccountDeletionStatus.mockResolvedValue({
      gracePeriodDays: 14,
      eligibility: { eligible: true, blockers: [] },
      pendingRequest: null,
    })

    const res = await GET()
    expect(res.status).toBe(200)

    // The only user id that reaches the boundary is the authenticated one.
    expect(mocks.loadAccountDeletionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1' }),
    )
  })
})

describe('POST /api/v1/me/account-deletion', () => {
  it('requires the typed confirmation before touching the boundary', async () => {
    const res = await post({})

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    })
    expect(mocks.requestAccountDeletion).not.toHaveBeenCalled()
  })

  it('reports a mismatched confirmation as a 400, not a server error', async () => {
    mocks.requestAccountDeletion.mockResolvedValue({
      ok: false,
      code: 'CONFIRMATION_MISMATCH',
    })

    const res = await post({ confirmEmail: 'someone-else@example.com' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
    })
  })

  it('surfaces blockers with a 409 so the UI can list what to settle', async () => {
    const blockers = [
      {
        code: 'UPCOMING_BOOKINGS_AS_PRO',
        message: 'You have 2 upcoming client appointments.',
        count: 2,
      },
    ]
    mocks.requestAccountDeletion.mockResolvedValue({
      ok: false,
      code: 'BLOCKED',
      blockers,
    })

    const res = await post({ confirmEmail: 'me@example.com' })

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('BLOCKED')
    // The server's own words reach the client verbatim — the UI renders these.
    expect(body.blockers).toEqual(blockers)
  })

  it('opens the window and returns 201', async () => {
    mocks.requestAccountDeletion.mockResolvedValue({
      ok: true,
      request: REQUEST_VIEW,
    })

    const res = await post({ confirmEmail: 'me@example.com', reason: 'moving' })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({
      request: REQUEST_VIEW,
      alreadyPending: false,
    })
    expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        confirmEmail: 'me@example.com',
        reason: 'moving',
      }),
    )
  })

  it('treats a second tap as success against the open window', async () => {
    mocks.requestAccountDeletion.mockResolvedValue({
      ok: false,
      code: 'ALREADY_PENDING',
      request: REQUEST_VIEW,
    })

    const res = await post({ confirmEmail: 'me@example.com' })

    // Not an error: the user asked for a thing that is already true.
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ alreadyPending: true })
  })
})

describe('DELETE /api/v1/me/account-deletion', () => {
  it('cancels the caller‘s pending request', async () => {
    mocks.cancelAccountDeletion.mockResolvedValue({
      ok: true,
      request: { ...REQUEST_VIEW, status: 'CANCELLED' },
    })

    const res = await DELETE()

    expect(res.status).toBe(200)
    expect(mocks.cancelAccountDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1' }),
    )
  })

  it('404s when there is nothing scheduled', async () => {
    mocks.cancelAccountDeletion.mockResolvedValue({
      ok: false,
      code: 'NOT_PENDING',
    })

    const res = await DELETE()

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ code: 'NOT_PENDING' })
  })

  it('refuses an unauthenticated caller', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: new Response('nope', { status: 401 }),
    })

    const res = await DELETE()

    expect(res.status).toBe(401)
    expect(mocks.cancelAccountDeletion).not.toHaveBeenCalled()
  })
})
