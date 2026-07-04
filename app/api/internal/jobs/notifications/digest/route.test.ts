import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runSocialDigest: vi.fn(),
}))

vi.mock('@/lib/notifications/socialDigest/runDigest', () => ({
  runSocialDigest: mocks.runSocialDigest,
}))

import { GET } from './route'

function makeRequest(headers: Record<string, string> = {}, url = 'https://x/api/internal/jobs/notifications/digest') {
  return new Request(url, { headers })
}

const RESULT = {
  emailConfigured: true,
  windowDays: 7,
  since: '2026-07-01T00:00:00.000Z',
  proRecipientsConsidered: 0,
  clientRecipientsConsidered: 0,
  sent: 0,
  skippedNoEmail: 0,
  skippedNoEnabledEvents: 0,
  failed: 0,
}

beforeEach(() => {
  mocks.runSocialDigest.mockReset()
  mocks.runSocialDigest.mockResolvedValue(RESULT)
  process.env.CRON_SECRET = 'digest_secret'
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.INTERNAL_JOB_SECRET
})

describe('GET /api/internal/jobs/notifications/digest', () => {
  it('returns 500 when no job secret is configured', async () => {
    delete process.env.CRON_SECRET
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    expect(mocks.runSocialDigest).not.toHaveBeenCalled()
  })

  it('returns 401 for an unauthorized request', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(mocks.runSocialDigest).not.toHaveBeenCalled()
  })

  it('runs the digest for an authorized request', async () => {
    const res = await GET(makeRequest({ authorization: 'Bearer digest_secret' }))
    expect(res.status).toBe(200)
    expect(mocks.runSocialDigest).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.sent).toBe(0)
    expect(body.processedAt).toBeTruthy()
  })

  it('clamps the window/max query params before passing them on', async () => {
    await GET(
      makeRequest(
        { authorization: 'Bearer digest_secret' },
        'https://x/api/internal/jobs/notifications/digest?days=999&max=-4',
      ),
    )
    const args = mocks.runSocialDigest.mock.calls[0]?.[0]
    expect(args.windowDays).toBe(30)
    expect(args.maxRecipients).toBe(1)
  })
})
