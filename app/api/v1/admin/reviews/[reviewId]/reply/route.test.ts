// app/api/v1/admin/reviews/[reviewId]/reply/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  reviewFindUnique: vi.fn(),
  clearReviewProReplyByAdmin: vi.fn(),
  writeAdminAuditLog: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    review: {
      findUnique: mocks.reviewFindUnique,
    },
  },
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

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/auth/requireAdminPermission', () => ({
  requireAdminPermission: mocks.requireAdminPermission,
}))

vi.mock('@/lib/adminModeration/reviews', () => ({
  clearReviewProReplyByAdmin: mocks.clearReviewProReplyByAdmin,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

import { DELETE } from './route'

function ctx(reviewId = 'review_1') {
  return { params: Promise.resolve({ reviewId }) }
}

function deleteRequest(): Request {
  return new Request('http://localhost/api/v1/admin/reviews/review_1/reply', {
    method: 'DELETE',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.reviewFindUnique.mockResolvedValue({
    id: 'review_1',
    professionalId: 'pro_1',
  })
  mocks.clearReviewProReplyByAdmin.mockResolvedValue({
    found: true,
    hadReply: true,
    professionalId: 'pro_1',
  })
})

describe('DELETE /api/v1/admin/reviews/[reviewId]/reply', () => {
  it('removes the pro reply cross-tenant and writes an audit log entry', async () => {
    const res = await DELETE(deleteRequest(), ctx())
    const json = (await res.json()) as { ok: boolean; hadReply: boolean }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, hadReply: true })

    expect(mocks.clearReviewProReplyByAdmin).toHaveBeenCalledWith({
      reviewId: 'review_1',
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'review_pro_reply_remove',
      professionalId: 'pro_1',
      targetType: 'review',
      targetId: 'review_1',
    })
  })

  it('skips the audit log when there was no reply to remove', async () => {
    mocks.clearReviewProReplyByAdmin.mockResolvedValue({
      found: true,
      hadReply: false,
      professionalId: 'pro_1',
    })

    const res = await DELETE(deleteRequest(), ctx())
    const json = (await res.json()) as { hadReply: boolean }

    expect(res.status).toBe(200)
    expect(json.hadReply).toBe(false)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('404s on an unknown review', async () => {
    mocks.reviewFindUnique.mockResolvedValue(null)

    const res = await DELETE(deleteRequest(), ctx())

    expect(res.status).toBe(404)
    expect(mocks.clearReviewProReplyByAdmin).not.toHaveBeenCalled()
  })

  it('propagates permission denials unchanged', async () => {
    const forbidden = new Response(null, { status: 403 })
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: forbidden })

    const res = await DELETE(deleteRequest(), ctx())

    expect(res).toBe(forbidden)
    expect(mocks.clearReviewProReplyByAdmin).not.toHaveBeenCalled()
  })
})
