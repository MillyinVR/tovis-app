import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueApplyLookViews: vi.fn(),
  getOptionalUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('@/lib/jobs/looksSocial/enqueue', () => ({
  enqueueApplyLookViews: mocks.enqueueApplyLookViews,
}))

vi.mock('@/app/api/_utils/auth/getOptionalUser', () => ({
  getOptionalUser: mocks.getOptionalUser,
}))

import { POST } from './route'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/looks/views', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/looks/views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enqueueApplyLookViews.mockResolvedValue({ id: 'job_1' })
    // Guest by default (no session) — the per-viewer §4.6 cap path stays off.
    mocks.getOptionalUser.mockResolvedValue(null)
  })

  it('enqueues a legacy id batch as FEED-sourced impressions and reports the accepted count', async () => {
    const res = await POST(
      makeRequest({ lookPostIds: ['look_1', ' look_1 ', 'look_2'] }),
    )

    expect(res.status).toBe(202)
    expect(mocks.enqueueApplyLookViews).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueApplyLookViews).toHaveBeenCalledWith(expect.anything(), {
      impressions: [
        { lookPostId: 'look_1', source: 'FEED' },
        { lookPostId: 'look_2', source: 'FEED' },
      ],
    })

    const body = (await res.json()) as { accepted: number }
    expect(body.accepted).toBe(2)
  })

  it('enqueues a source-tagged batch, coercing an unknown source to FEED', async () => {
    const res = await POST(
      makeRequest({
        impressions: [
          { lookPostId: 'look_1', source: 'DETAIL' },
          { lookPostId: 'look_2', source: 'bogus' },
        ],
      }),
    )

    expect(res.status).toBe(202)
    expect(mocks.enqueueApplyLookViews).toHaveBeenCalledWith(expect.anything(), {
      impressions: [
        { lookPostId: 'look_1', source: 'DETAIL' },
        { lookPostId: 'look_2', source: 'FEED' },
      ],
    })

    const body = (await res.json()) as { accepted: number }
    expect(body.accepted).toBe(2)
  })

  it('threads the signed-in viewer id into the job (§4.6 impression cap)', async () => {
    mocks.getOptionalUser.mockResolvedValue({ id: 'user_1' })

    const res = await POST(makeRequest({ lookPostIds: ['look_1'] }))

    expect(res.status).toBe(202)
    expect(mocks.enqueueApplyLookViews).toHaveBeenCalledWith(expect.anything(), {
      impressions: [{ lookPostId: 'look_1', source: 'FEED' }],
      viewerId: 'user_1',
    })
  })

  it('omits the viewer id for a guest flush', async () => {
    const res = await POST(makeRequest({ lookPostIds: ['look_1'] }))

    expect(res.status).toBe(202)
    expect(mocks.enqueueApplyLookViews).toHaveBeenCalledWith(expect.anything(), {
      impressions: [{ lookPostId: 'look_1', source: 'FEED' }],
    })
  })

  it('accepts an empty flush without enqueuing anything', async () => {
    const res = await POST(makeRequest({ lookPostIds: ['', '   '] }))

    expect(res.status).toBe(202)
    expect(mocks.enqueueApplyLookViews).not.toHaveBeenCalled()

    const body = (await res.json()) as { accepted: number }
    expect(body.accepted).toBe(0)
  })

  it('tolerates a malformed body', async () => {
    const res = await POST(
      new Request('http://localhost/api/v1/looks/views', {
        method: 'POST',
        body: 'not json',
      }),
    )

    expect(res.status).toBe(202)
    expect(mocks.enqueueApplyLookViews).not.toHaveBeenCalled()
  })
})
