import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  expireStaleUploadSessions: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: (status: number, error: string) =>
    new Response(JSON.stringify({ ok: false, error }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  jsonOk: (data: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify({ ok: true, ...data }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/media/uploadSession', () => ({
  expireStaleUploadSessions: mocks.expireStaleUploadSessions,
}))

vi.mock('@/lib/security/logging', () => ({ safeError: (e: unknown) => e }))

import { GET, POST } from './route'

function makeRequest(
  headers: Record<string, string> = {},
  method = 'POST',
): Request {
  return new Request('http://localhost/api/internal/jobs/upload-sessions/cleanup', {
    method,
    headers,
  })
}

describe('POST /api/internal/jobs/upload-sessions/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_JOB_SECRET = 'job-secret'
    mocks.expireStaleUploadSessions.mockResolvedValue(4)
  })

  afterEach(() => {
    delete process.env.INTERNAL_JOB_SECRET
  })

  it('rejects an unauthorized request', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(mocks.expireStaleUploadSessions).not.toHaveBeenCalled()
  })

  it('expires stale sessions when authorized and returns the count', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer job-secret' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, expired: 4 })
    expect(mocks.expireStaleUploadSessions).toHaveBeenCalledTimes(1)
  })

  it('accepts the x-internal-job-secret header too', async () => {
    const res = await POST(makeRequest({ 'x-internal-job-secret': 'job-secret' }))
    expect(res.status).toBe(200)
  })

  // Vercel cron invokes scheduled jobs via GET, so the GET export must enforce
  // the same auth and run the same reap.
  it('rejects an unauthorized GET (Vercel cron entrypoint)', async () => {
    const res = await GET(makeRequest({}, 'GET'))
    expect(res.status).toBe(401)
    expect(mocks.expireStaleUploadSessions).not.toHaveBeenCalled()
  })

  it('expires stale sessions on an authorized GET', async () => {
    const res = await GET(
      makeRequest({ authorization: 'Bearer job-secret' }, 'GET'),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, expired: 4 })
    expect(mocks.expireStaleUploadSessions).toHaveBeenCalledTimes(1)
  })
})
