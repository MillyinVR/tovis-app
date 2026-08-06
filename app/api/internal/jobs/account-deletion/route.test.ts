// app/api/internal/jobs/account-deletion/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getInternalJobSecret: vi.fn(),
  isAuthorizedJobRequest: vi.fn(),
  executeDueAccountDeletions: vi.fn(),
  capturePrivacyException: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: (data: unknown, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...(data as object) }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonFail: (status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/app/api/_utils/auth/internalJob', () => ({
  getInternalJobSecret: mocks.getInternalJobSecret,
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}))

vi.mock('@/lib/privacy/accountDeletion', () => ({
  executeDueAccountDeletions: mocks.executeDueAccountDeletions,
}))

vi.mock('@/lib/observability/privacyEvents', () => ({
  capturePrivacyException: mocks.capturePrivacyException,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { GET, POST } from './route'

function req() {
  return new Request('http://localhost/api/internal/jobs/account-deletion')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getInternalJobSecret.mockReturnValue('job-secret')
  mocks.isAuthorizedJobRequest.mockReturnValue(true)
  mocks.executeDueAccountDeletions.mockResolvedValue({
    considered: 3,
    completed: 2,
    failed: 0,
    deferred: 1,
  })
})

describe('the account-deletion sweep endpoint', () => {
  // This route irreversibly anonymizes accounts. An unauthenticated caller
  // reaching it is the worst failure this codebase has, so the refusal is
  // asserted before anything else.
  it('refuses an unauthorized caller WITHOUT running the sweep', async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.executeDueAccountDeletions).not.toHaveBeenCalled()
  })

  it('refuses to run at all when no job secret is configured', async () => {
    // Fail closed: a missing secret must not degrade into "no auth required".
    mocks.getInternalJobSecret.mockReturnValue(null)

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect(mocks.executeDueAccountDeletions).not.toHaveBeenCalled()
  })

  it('runs the sweep and reports deferrals separately from completions', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.considered).toBe(3)
    expect(body.completed).toBe(2)
    expect(body.failed).toBe(0)
    // Without this, "completed: 0" reads identically to "nothing was due" —
    // the sweep would look idle while it was actually holding requests back.
    expect(body.deferred).toBe(1)
    expect(typeof body.ranAt).toBe('string')
  })

  it('accepts POST as well as GET, with the same gating', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)

    mocks.isAuthorizedJobRequest.mockReturnValue(false)
    const refused = await POST(req())
    expect(refused.status).toBe(401)
  })

  it('does not leak the failure detail when the sweep throws', async () => {
    mocks.executeDueAccountDeletions.mockRejectedValue(
      new Error('connection string postgres://user:pw@host/db failed'),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })

  // A sweep run that throws outright must page a human — the JSON 500 body
  // is only ever read by whatever dispatched the cron, not a person.
  it('captures a privacy exception when the sweep throws', async () => {
    const error = new Error('db unreachable')
    mocks.executeDueAccountDeletions.mockRejectedValue(error)

    await GET(req())

    expect(mocks.capturePrivacyException).toHaveBeenCalledTimes(1)
    expect(mocks.capturePrivacyException).toHaveBeenCalledWith({
      error,
      route: 'GET /api/internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_SWEEP_ERROR',
    })
  })

  it('does not capture a privacy exception when the sweep succeeds', async () => {
    await GET(req())

    expect(mocks.capturePrivacyException).not.toHaveBeenCalled()
  })
})
