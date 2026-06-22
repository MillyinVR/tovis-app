import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pruneExpiredTapIntents: vi.fn(),
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

vi.mock('@/lib/nfc/cleanupTapIntents', () => ({
  pruneExpiredTapIntents: mocks.pruneExpiredTapIntents,
}))

vi.mock('@/lib/security/logging', () => ({ safeError: (e: unknown) => e }))

import { GET, POST } from './route'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/internal/jobs/nfc/tap-intent-cleanup', {
    method: 'POST',
    headers,
  })
}

describe('POST /api/internal/jobs/nfc/tap-intent-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_JOB_SECRET = 'job-secret'
    mocks.pruneExpiredTapIntents.mockResolvedValue(11)
  })

  afterEach(() => {
    delete process.env.INTERNAL_JOB_SECRET
  })

  it('rejects an unauthorized request', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(mocks.pruneExpiredTapIntents).not.toHaveBeenCalled()
  })

  it('prunes expired tap intents when authorized and returns the count', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer job-secret' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, deleted: 11 })
    expect(mocks.pruneExpiredTapIntents).toHaveBeenCalledTimes(1)
  })

  it('accepts the GET cron invocation with the x-internal-job-secret header', async () => {
    const res = await GET(makeRequest({ 'x-internal-job-secret': 'job-secret' }))
    expect(res.status).toBe(200)
  })
})
