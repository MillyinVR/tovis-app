// app/api/internal/jobs/license-doc-retention/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthorizedJobRequest: vi.fn(),
  runVerificationDocRetentionSweep: vi.fn(),
  captureLicensingException: vi.fn(),
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
  isAuthorizedJobRequest: mocks.isAuthorizedJobRequest,
}))

vi.mock('@/lib/licensing/verificationDocRetention', () => ({
  runVerificationDocRetentionSweep: mocks.runVerificationDocRetentionSweep,
}))

vi.mock('@/lib/observability/licensingEvents', () => ({
  captureLicensingException: mocks.captureLicensingException,
}))

import { GET, POST } from './route'

function req() {
  return new Request('http://localhost/api/internal/jobs/license-doc-retention')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAuthorizedJobRequest.mockReturnValue(true)
  mocks.runVerificationDocRetentionSweep.mockResolvedValue({
    considered: 4,
    purged: 3,
    failed: 1,
  })
})

describe('the license-doc-retention sweep endpoint', () => {
  it('refuses an unauthorized caller WITHOUT running the sweep', async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.runVerificationDocRetentionSweep).not.toHaveBeenCalled()
  })

  it('runs the sweep and reports the result shape', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.considered).toBe(4)
    expect(body.purged).toBe(3)
    expect(body.failed).toBe(1)
  })

  it('accepts POST as well as GET, with the same gating', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)

    mocks.isAuthorizedJobRequest.mockReturnValue(false)
    const refused = await POST(req())
    expect(refused.status).toBe(401)
  })

  it('does not leak the failure detail when the sweep throws', async () => {
    mocks.runVerificationDocRetentionSweep.mockRejectedValue(
      new Error('connection string postgres://user:pw@host/db failed'),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })

  it('captures a licensing exception when the sweep itself throws', async () => {
    const error = new Error('db unreachable')
    mocks.runVerificationDocRetentionSweep.mockRejectedValue(error)

    await GET(req())

    expect(mocks.captureLicensingException).toHaveBeenCalledTimes(1)
    expect(mocks.captureLicensingException).toHaveBeenCalledWith({
      error,
      route: 'GET /api/internal/jobs/license-doc-retention',
      event: 'LICENSE_DOC_RETENTION_SWEEP_ERROR',
    })
  })

  it('does not capture a licensing exception when the sweep succeeds', async () => {
    await GET(req())

    expect(mocks.captureLicensingException).not.toHaveBeenCalled()
  })
})
