// app/api/v1/pro/reviews/[id]/reply/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  reviewUpdateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    review: {
      updateMany: mocks.reviewUpdateMany,
    },
  },
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
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

import { DELETE, PUT } from './route'

function ctx(id = 'review_1') {
  return { params: Promise.resolve({ id }) }
}

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/pro/reviews/review_1/reply', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteRequest(): Request {
  return new Request('http://localhost/api/v1/pro/reviews/review_1/reply', {
    method: 'DELETE',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  mocks.requirePro.mockResolvedValue({ ok: true, professionalId: 'pro_1' })
  mocks.reviewUpdateMany.mockResolvedValue({ count: 1 })
})

describe('PUT /api/v1/pro/reviews/[id]/reply', () => {
  it('upserts the reply with ownership enforced in the where clause', async () => {
    const res = await PUT(putRequest({ body: '  Thank you!  ' }), ctx())
    const json = (await res.json()) as {
      ok: boolean
      reviewId: string
      reply: { body: string; repliedAtISO: string }
    }

    expect(res.status).toBe(200)
    expect(json.reviewId).toBe('review_1')
    expect(json.reply.body).toBe('Thank you!')
    expect(Date.parse(json.reply.repliedAtISO)).not.toBeNaN()

    expect(mocks.reviewUpdateMany).toHaveBeenCalledWith({
      where: { id: 'review_1', professionalId: 'pro_1' },
      data: {
        proReplyBody: 'Thank you!',
        proReplyAt: expect.any(Date),
      },
    })
  })

  it('404s for a review the pro does not own (no existence leak)', async () => {
    mocks.reviewUpdateMany.mockResolvedValue({ count: 0 })

    const res = await PUT(putRequest({ body: 'Hi' }), ctx())

    expect(res.status).toBe(404)
  })

  it('400s on empty or over-long bodies', async () => {
    expect((await PUT(putRequest({ body: '   ' }), ctx())).status).toBe(400)
    expect(
      (await PUT(putRequest({ body: 'x'.repeat(1001) }), ctx())).status,
    ).toBe(400)
    expect((await PUT(putRequest({}), ctx())).status).toBe(400)
    expect(mocks.reviewUpdateMany).not.toHaveBeenCalled()
  })

  it('propagates auth failures unchanged', async () => {
    const denied = new Response(null, { status: 401 })
    mocks.requirePro.mockResolvedValue({ ok: false, res: denied })

    const res = await PUT(putRequest({ body: 'Hi' }), ctx())

    expect(res).toBe(denied)
    expect(mocks.reviewUpdateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/pro/reviews/[id]/reply', () => {
  it('clears the reply with ownership enforced', async () => {
    const res = await DELETE(deleteRequest(), ctx())
    const json = (await res.json()) as { reviewId: string; deleted: boolean }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ reviewId: 'review_1', deleted: true })

    expect(mocks.reviewUpdateMany).toHaveBeenCalledWith({
      where: { id: 'review_1', professionalId: 'pro_1' },
      data: { proReplyBody: null, proReplyAt: null },
    })
  })

  it('404s for a review the pro does not own', async () => {
    mocks.reviewUpdateMany.mockResolvedValue({ count: 0 })

    const res = await DELETE(deleteRequest(), ctx())

    expect(res.status).toBe(404)
  })
})
