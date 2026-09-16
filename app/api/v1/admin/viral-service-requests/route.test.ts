// app/api/v1/admin/viral-service-requests/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  listAdminViralRequests: vi.fn(),
  toViralRequestDto: vi.fn(),
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

vi.mock('@/lib/viralRequests', () => ({
  listAdminViralRequests: mocks.listAdminViralRequests,
}))

vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
}))

vi.mock('@/lib/prisma', () => ({ prisma: { __brand: 'prisma' } }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.listAdminViralRequests.mockResolvedValue([])
  mocks.toViralRequestDto.mockImplementation((row: { id: string }) => ({
    id: row.id,
    dto: true,
  }))
})

describe('GET /api/v1/admin/viral-service-requests', () => {
  it('serves the queue as DTOs, preserving the helper’s order', async () => {
    // The helper floats REQUESTED/IN_REVIEW to the top; the route must not
    // re-sort, or the native queue and the web page disagree on what is next.
    mocks.listAdminViralRequests.mockResolvedValue([
      { id: 'vr_actionable' },
      { id: 'vr_decided' },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      items: [
        { id: 'vr_actionable', dto: true },
        { id: 'vr_decided', dto: true },
      ],
    })
  })

  it('allows SUPER_ADMIN and REVIEWER, matching the moderate endpoint', async () => {
    await GET()
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: ['SUPER_ADMIN', 'REVIEWER'],
    })
  })

  it('reads nothing when the permission check refuses', async () => {
    const forbidden = new Response(null, { status: 403 })
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: forbidden })

    const res = await GET()
    expect(res).toBe(forbidden)
    expect(mocks.listAdminViralRequests).not.toHaveBeenCalled()
  })

  it('propagates the auth refusal verbatim', async () => {
    const unauthorized = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res: unauthorized })

    const res = await GET()
    expect(res).toBe(unauthorized)
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
  })

  it('returns 500 when the queue read throws', async () => {
    mocks.listAdminViralRequests.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
