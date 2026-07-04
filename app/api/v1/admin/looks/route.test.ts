// app/api/v1/admin/looks/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  listAdminLookModeration: vi.fn(),
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

vi.mock('@/lib/privacy/adminLookModeration', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/privacy/adminLookModeration')
  >('@/lib/privacy/adminLookModeration')
  return {
    ...actual,
    listAdminLookModeration: mocks.listAdminLookModeration,
  }
})

import { GET } from './route'

function req(qs = '') {
  return new Request(`http://localhost/api/v1/admin/looks${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.listAdminLookModeration.mockResolvedValue([])
})

describe('GET /api/v1/admin/looks', () => {
  it('defaults to the REPORTED queue and requires SUPER_ADMIN', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: ['SUPER_ADMIN'],
    })
    expect(mocks.listAdminLookModeration).toHaveBeenCalledWith({
      status: 'REPORTED',
      q: '',
    })
  })

  it('passes through a valid status + query and ignores junk status', async () => {
    await GET(req('?status=PENDING&q=glow'))
    expect(mocks.listAdminLookModeration).toHaveBeenCalledWith({
      status: 'PENDING',
      q: 'glow',
    })

    mocks.listAdminLookModeration.mockClear()
    await GET(req('?status=bogus'))
    expect(mocks.listAdminLookModeration).toHaveBeenCalledWith({
      status: 'REPORTED',
      q: '',
    })
  })

  it('propagates permission denials', async () => {
    const forbidden = new Response(null, { status: 403 })
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: forbidden })
    const res = await GET(req())
    expect(res).toBe(forbidden)
    expect(mocks.listAdminLookModeration).not.toHaveBeenCalled()
  })
})
