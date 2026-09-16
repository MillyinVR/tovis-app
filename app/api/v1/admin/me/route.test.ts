// app/api/v1/admin/me/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getAdminUiPermsForUser: vi.fn(),
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

vi.mock('@/lib/adminUiPermissions', () => ({
  getAdminUiPermsForUser: mocks.getAdminUiPermsForUser,
}))

import { GET } from './route'

const PERMS = {
  canReviewPros: true,
  canManageCatalog: false,
  canManagePermissions: false,
  canViewLogs: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.requireUser.mockResolvedValue({
    ok: true,
    user: { id: 'admin_1', email: 'admin@example.com' },
  })
  mocks.getAdminUiPermsForUser.mockResolvedValue(PERMS)
})

describe('GET /api/v1/admin/me', () => {
  it('returns the acting admin and their permission map', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      admin: {
        userId: 'admin_1',
        email: 'admin@example.com',
        perms: PERMS,
      },
    })
    expect(mocks.requireUser).toHaveBeenCalledWith({ roles: ['ADMIN'] })
    expect(mocks.getAdminUiPermsForUser).toHaveBeenCalledWith('admin_1')
  })

  it('propagates the auth refusal verbatim so 401 and 403 stay distinct', async () => {
    // The whole reason this route does not use getAdminUiPerms(): a native
    // client must re-authenticate on 401 and must NOT on 403.
    const unauthorized = new Response(null, { status: 401 })
    mocks.requireUser.mockResolvedValue({ ok: false, res: unauthorized })

    const res = await GET()
    expect(res).toBe(unauthorized)
    expect(mocks.getAdminUiPermsForUser).not.toHaveBeenCalled()
  })

  it('fails closed with a 500 when the permission lookup throws', async () => {
    mocks.getAdminUiPermsForUser.mockRejectedValue(new Error('db down'))
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
