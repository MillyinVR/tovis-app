// app/api/v1/admin/memberships/[professionalId]/camera/route.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireMembershipAdmin: vi.fn(),
  getProCameraUsage: vi.fn(),
  grantCameraBonusImages: vi.fn(),
  writeAdminAuditLog: vi.fn(),
}))

// Mock the shared SUPER_ADMIN gate so the route tests don't drag in
// requireUser / requireAdminPermission / prisma.
vi.mock('../../_adminAuth', () => ({
  requireMembershipAdmin: mocks.requireMembershipAdmin,
}))

vi.mock('@/lib/pro/cameraQuota', () => ({
  getProCameraUsage: mocks.getProCameraUsage,
  grantCameraBonusImages: mocks.grantCameraBonusImages,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

import { GET, POST } from './route'

const USAGE = {
  used: 2,
  baseQuota: 6,
  bonus: 5,
  quota: 11,
  remaining: 9,
  enforced: true,
}

function postReq(body?: unknown): Request {
  return new Request(
    'http://localhost/api/v1/admin/memberships/pro-1/camera',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  )
}

function getReq(): Request {
  return new Request('http://localhost/api/v1/admin/memberships/pro-1/camera')
}

function ctx(professionalId = 'pro-1'): { params: { professionalId: string } } {
  return { params: { professionalId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireMembershipAdmin.mockResolvedValue({
    ok: true,
    adminUserId: 'admin-1',
    professionalId: 'pro-1',
  })
  mocks.getProCameraUsage.mockResolvedValue(USAGE)
  mocks.grantCameraBonusImages.mockResolvedValue(5)
  mocks.writeAdminAuditLog.mockResolvedValue(undefined)
})

describe('GET /api/v1/admin/memberships/[professionalId]/camera', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response(null, { status: 403 })
    mocks.requireMembershipAdmin.mockResolvedValue({ ok: false, res })

    expect(await GET(getReq(), ctx())).toBe(res)
    expect(mocks.getProCameraUsage).not.toHaveBeenCalled()
  })

  it('returns the pro camera usage for the scoped professional', async () => {
    const res = await GET(getReq(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, usage: USAGE })
    expect(mocks.getProCameraUsage).toHaveBeenCalledWith({
      professionalId: 'pro-1',
    })
  })
})

describe('POST /api/v1/admin/memberships/[professionalId]/camera', () => {
  it('returns the auth failure response untouched', async () => {
    const res = new Response(null, { status: 403 })
    mocks.requireMembershipAdmin.mockResolvedValue({ ok: false, res })

    expect(await POST(postReq({ count: 5 }), ctx())).toBe(res)
    expect(mocks.grantCameraBonusImages).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('grants bonus images, writes an audit log, and returns fresh usage', async () => {
    mocks.grantCameraBonusImages.mockResolvedValue(8)

    const res = await POST(postReq({ count: 5 }), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, usage: USAGE })

    expect(mocks.grantCameraBonusImages).toHaveBeenCalledWith({
      professionalId: 'pro-1',
      count: 5,
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: 'camera_bonus_grant',
      professionalId: 'pro-1',
      newValue: { granted: 5, bonusTotal: 8 },
    })
    expect(mocks.getProCameraUsage).toHaveBeenCalledWith({
      professionalId: 'pro-1',
    })
  })

  it('coerces a numeric-string count', async () => {
    const res = await POST(postReq({ count: '3' }), ctx())
    expect(res.status).toBe(200)
    expect(mocks.grantCameraBonusImages).toHaveBeenCalledWith({
      professionalId: 'pro-1',
      count: 3,
    })
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['over the per-grant cap', 501],
    ['non-integer', 2.5],
    ['missing', undefined],
  ])('rejects a %s count with 400 and grants nothing', async (_label, count) => {
    const body = count === undefined ? {} : { count }
    const res = await POST(postReq(body), ctx())

    expect(res.status).toBe(400)
    expect(mocks.grantCameraBonusImages).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('returns 503 (and skips the audit log) when the grant fails', async () => {
    mocks.grantCameraBonusImages.mockResolvedValue(null)

    const res = await POST(postReq({ count: 5 }), ctx())
    expect(res.status).toBe(503)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })
})
