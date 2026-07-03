// app/api/v1/admin/reviews/[reviewId]/hidden/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  reviewFindUnique: vi.fn(),
  hideReviewByAdmin: vi.fn(),
  unhideReviewByAdmin: vi.fn(),
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
  hideReviewByAdmin: mocks.hideReviewByAdmin,
  unhideReviewByAdmin: mocks.unhideReviewByAdmin,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

import { DELETE, PUT } from './route'

function ctx(reviewId = 'review_1') {
  return { params: Promise.resolve({ reviewId }) }
}

function putRequest(body?: unknown): Request {
  return new Request('http://localhost/api/v1/admin/reviews/review_1/hidden', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function deleteRequest(): Request {
  return new Request('http://localhost/api/v1/admin/reviews/review_1/hidden', {
    method: 'DELETE',
  })
}

const HIDDEN_AT = new Date('2026-07-03T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.reviewFindUnique.mockResolvedValue({
    id: 'review_1',
    professionalId: 'pro_1',
  })
  mocks.hideReviewByAdmin.mockResolvedValue({
    found: true,
    alreadyHidden: false,
    professionalId: 'pro_1',
    hiddenAt: HIDDEN_AT,
  })
  mocks.unhideReviewByAdmin.mockResolvedValue({
    found: true,
    wasHidden: true,
    professionalId: 'pro_1',
  })
})

describe('PUT /api/v1/admin/reviews/[reviewId]/hidden', () => {
  it('hides the review and writes an audit log entry', async () => {
    const res = await PUT(putRequest({ reason: '  Harassment  ' }), ctx())
    const json = (await res.json()) as { ok: boolean; hidden: boolean }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, hidden: true })

    expect(mocks.hideReviewByAdmin).toHaveBeenCalledWith({
      reviewId: 'review_1',
      adminUserId: 'admin_1',
      reason: 'Harassment',
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'review_hide',
      professionalId: 'pro_1',
      targetType: 'review',
      targetId: 'review_1',
      note: 'Harassment',
      newValue: { hiddenAt: HIDDEN_AT.toISOString() },
    })
  })

  it('checks a SUPER_ADMIN permission scoped to the reviewed pro', async () => {
    await PUT(putRequest({}), ctx())

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: ['SUPER_ADMIN'],
      scope: { professionalId: 'pro_1' },
    })
  })

  it('skips the audit log when the review was already hidden', async () => {
    mocks.hideReviewByAdmin.mockResolvedValue({
      found: true,
      alreadyHidden: true,
      professionalId: 'pro_1',
    })

    const res = await PUT(putRequest({}), ctx())

    expect(res.status).toBe(200)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('404s on an unknown review before checking permissions', async () => {
    mocks.reviewFindUnique.mockResolvedValue(null)

    const res = await PUT(putRequest({}), ctx())

    expect(res.status).toBe(404)
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.hideReviewByAdmin).not.toHaveBeenCalled()
  })

  it('propagates auth failures unchanged', async () => {
    const denied = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res: denied })

    const res = await PUT(putRequest({}), ctx())

    expect(res).toBe(denied)
    expect(mocks.hideReviewByAdmin).not.toHaveBeenCalled()
  })

  it('propagates permission denials unchanged', async () => {
    const forbidden = new Response(null, { status: 403 })
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: forbidden })

    const res = await PUT(putRequest({}), ctx())

    expect(res).toBe(forbidden)
    expect(mocks.hideReviewByAdmin).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/admin/reviews/[reviewId]/hidden', () => {
  it('unhides the review and writes an audit log entry', async () => {
    const res = await DELETE(deleteRequest(), ctx())
    const json = (await res.json()) as { ok: boolean; hidden: boolean }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, hidden: false })

    expect(mocks.unhideReviewByAdmin).toHaveBeenCalledWith({
      reviewId: 'review_1',
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      action: 'review_unhide',
      professionalId: 'pro_1',
      targetType: 'review',
      targetId: 'review_1',
    })
  })

  it('skips the audit log when the review was not hidden', async () => {
    mocks.unhideReviewByAdmin.mockResolvedValue({
      found: true,
      wasHidden: false,
      professionalId: 'pro_1',
    })

    const res = await DELETE(deleteRequest(), ctx())

    expect(res.status).toBe(200)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })
})
