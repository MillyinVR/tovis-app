// app/api/v1/admin/looks/[id]/feature/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  lookFindUnique: vi.fn(),
  setLookPostFeatured: vi.fn(),
  writeAdminAuditLog: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { lookPost: { findUnique: mocks.lookFindUnique } },
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

vi.mock('@/lib/looks/featuring', () => ({
  setLookPostFeatured: mocks.setLookPostFeatured,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

import { DELETE, PUT } from './route'

function ctx(id = 'look_1') {
  return { params: Promise.resolve({ id }) }
}

const FEATURED_AT = new Date('2026-07-04T12:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.lookFindUnique.mockResolvedValue({
    id: 'look_1',
    professionalId: 'pro_1',
    serviceId: 'svc_1',
    service: { categoryId: 'cat_1' },
  })
  mocks.setLookPostFeatured.mockResolvedValue({
    found: true,
    changed: true,
    featured: true,
    featuredAt: FEATURED_AT,
    professionalId: 'pro_1',
    serviceId: 'svc_1',
    categoryId: 'cat_1',
  })
})

describe('PUT /api/v1/admin/looks/[id]/feature', () => {
  it('features the look and writes an audit log entry', async () => {
    const res = await PUT(new Request('http://localhost'), ctx())
    const json = (await res.json()) as { ok: boolean; featured: boolean }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, featured: true })
    expect(mocks.setLookPostFeatured).toHaveBeenCalledWith(expect.anything(), {
      lookPostId: 'look_1',
      adminUserId: 'admin_1',
      featured: true,
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin_1',
        action: 'LOOK_POST_FEATURED',
        professionalId: 'pro_1',
        targetId: 'look_1',
      }),
    )
  })

  it('requires a SUPER_ADMIN scoped to the look', async () => {
    await PUT(new Request('http://localhost'), ctx())
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: ['SUPER_ADMIN'],
      scope: {
        professionalId: 'pro_1',
        serviceId: 'svc_1',
        categoryId: 'cat_1',
      },
    })
  })

  it('skips the audit log on a no-op re-feature', async () => {
    mocks.setLookPostFeatured.mockResolvedValue({
      found: true,
      changed: false,
      featured: true,
      featuredAt: FEATURED_AT,
      professionalId: 'pro_1',
      serviceId: 'svc_1',
      categoryId: 'cat_1',
    })
    const res = await PUT(new Request('http://localhost'), ctx())
    expect(res.status).toBe(200)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('404s on an unknown look before checking permissions', async () => {
    mocks.lookFindUnique.mockResolvedValue(null)
    const res = await PUT(new Request('http://localhost'), ctx())
    expect(res.status).toBe(404)
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.setLookPostFeatured).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/admin/looks/[id]/feature', () => {
  it('unfeatures the look and audits LOOK_POST_UNFEATURED', async () => {
    mocks.setLookPostFeatured.mockResolvedValue({
      found: true,
      changed: true,
      featured: false,
      featuredAt: null,
      professionalId: 'pro_1',
      serviceId: 'svc_1',
      categoryId: 'cat_1',
    })
    const res = await DELETE(new Request('http://localhost'), ctx())
    const json = (await res.json()) as { ok: boolean; featured: boolean }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, featured: false })
    expect(mocks.setLookPostFeatured).toHaveBeenCalledWith(expect.anything(), {
      lookPostId: 'look_1',
      adminUserId: 'admin_1',
      featured: false,
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOOK_POST_UNFEATURED' }),
    )
  })
})
