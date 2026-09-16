// app/api/v1/admin/moderation/counts/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  countAdminLookModeration: vi.fn(),
  countAdminLookCommentModeration: vi.fn(),
  countAdminViralRequestsAwaitingReview: vi.fn(),
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

vi.mock('@/lib/privacy/adminLookModeration', () => ({
  countAdminLookModeration: mocks.countAdminLookModeration,
  countAdminLookCommentModeration: mocks.countAdminLookCommentModeration,
}))

vi.mock('@/lib/viralRequests', () => ({
  countAdminViralRequestsAwaitingReview:
    mocks.countAdminViralRequestsAwaitingReview,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.countAdminLookModeration.mockImplementation(
    async (args: { status: string }) => (args.status === 'REPORTED' ? 7 : 3),
  )
  mocks.countAdminLookCommentModeration.mockResolvedValue(2)
  mocks.countAdminViralRequestsAwaitingReview.mockResolvedValue(5)
})

describe('GET /api/v1/admin/moderation/counts', () => {
  it('returns every queue count and no row data', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      counts: {
        reportedLooks: 7,
        pendingLooks: 3,
        reportedComments: 2,
        viralAwaitingReview: 5,
      },
    })
  })

  it('counts the same queues the lists serve', async () => {
    await GET()
    expect(mocks.countAdminLookModeration).toHaveBeenCalledWith({
      status: 'REPORTED',
    })
    expect(mocks.countAdminLookModeration).toHaveBeenCalledWith({
      status: 'PENDING',
    })
    expect(mocks.countAdminLookCommentModeration).toHaveBeenCalledWith({
      status: 'REPORTED',
    })
  })

  it('requires SUPER_ADMIN, matching the lists it summarises', async () => {
    await GET()
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: ['SUPER_ADMIN'],
    })
  })

  it('counts nothing when the permission check refuses', async () => {
    const forbidden = new Response(null, { status: 403 })
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: forbidden })

    const res = await GET()
    expect(res).toBe(forbidden)
    expect(mocks.countAdminLookModeration).not.toHaveBeenCalled()
    expect(mocks.countAdminViralRequestsAwaitingReview).not.toHaveBeenCalled()
  })

  it('returns 500 rather than a partial count when one query fails', async () => {
    mocks.countAdminViralRequestsAwaitingReview.mockRejectedValue(
      new Error('db down'),
    )
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
