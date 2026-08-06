// app/api/internal/jobs/license-expiry/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthorizedJobRequest: vi.fn(),
  runLicenseExpiryNotifications: vi.fn(),
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

vi.mock('@/lib/licensing/licenseExpiryNotifications', () => ({
  runLicenseExpiryNotifications: mocks.runLicenseExpiryNotifications,
}))

import { GET, POST } from './route'

function req() {
  return new Request('http://localhost/api/internal/jobs/license-expiry')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAuthorizedJobRequest.mockReturnValue(true)
  mocks.runLicenseExpiryNotifications.mockResolvedValue({
    warned: 2,
    expired: 1,
  })
})

describe('the license-expiry sweep endpoint', () => {
  it('refuses an unauthorized caller WITHOUT running the sweep', async () => {
    mocks.isAuthorizedJobRequest.mockReturnValue(false)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mocks.runLicenseExpiryNotifications).not.toHaveBeenCalled()
  })

  it('runs the sweep and reports the result shape', async () => {
    const res = await GET(req())

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.warned).toBe(2)
    expect(body.expired).toBe(1)
  })

  it('accepts POST as well as GET, with the same gating', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)

    mocks.isAuthorizedJobRequest.mockReturnValue(false)
    const refused = await POST(req())
    expect(refused.status).toBe(401)
  })

  it('does not leak the failure detail when the sweep throws', async () => {
    mocks.runLicenseExpiryNotifications.mockRejectedValue(
      new Error('connection string postgres://user:pw@host/db failed'),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })
})
