// app/api/v1/admin/looks/[id]/dismiss-reports/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  lookFindUnique: vi.fn(),
  dismissLookPostReports: vi.fn(),
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

vi.mock('@/lib/adminModeration/lookReports', () => ({
  dismissLookPostReports: mocks.dismissLookPostReports,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

import { POST } from './route'

function ctx(id = 'look_1') {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.lookFindUnique.mockResolvedValue({
    id: 'look_1',
    professionalId: 'pro_1',
    serviceId: null,
    service: null,
  })
  mocks.dismissLookPostReports.mockResolvedValue({
    found: true,
    dismissedCount: 2,
    professionalId: 'pro_1',
    serviceId: null,
  })
})

describe('POST /api/v1/admin/looks/[id]/dismiss-reports', () => {
  it('dismisses reports and audits the count', async () => {
    const res = await POST(new Request('http://localhost'), ctx())
    const json = (await res.json()) as { ok: boolean; dismissedCount: number }

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, dismissedCount: 2 })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOOK_POST_REPORTS_DISMISSED',
        professionalId: 'pro_1',
        targetId: 'look_1',
        newValue: { dismissedCount: 2 },
      }),
    )
  })

  it('skips the audit log when nothing was unresolved', async () => {
    mocks.dismissLookPostReports.mockResolvedValue({
      found: true,
      dismissedCount: 0,
      professionalId: 'pro_1',
      serviceId: null,
    })
    const res = await POST(new Request('http://localhost'), ctx())
    expect(res.status).toBe(200)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('404s on an unknown look', async () => {
    mocks.lookFindUnique.mockResolvedValue(null)
    const res = await POST(new Request('http://localhost'), ctx())
    expect(res.status).toBe(404)
    expect(mocks.dismissLookPostReports).not.toHaveBeenCalled()
  })

  it('propagates permission denials', async () => {
    const forbidden = new Response(null, { status: 403 })
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, res: forbidden })
    const res = await POST(new Request('http://localhost'), ctx())
    expect(res).toBe(forbidden)
    expect(mocks.dismissLookPostReports).not.toHaveBeenCalled()
  })
})
