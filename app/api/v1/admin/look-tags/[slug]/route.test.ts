// app/api/v1/admin/look-tags/[slug]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  setLookTagBanned: vi.fn(),
  renameLookTag: vi.fn(),
  mergeLookTags: vi.fn(),
  writeAdminAuditLog: vi.fn(),
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

vi.mock('@/lib/looks/adminTags', () => ({
  setLookTagBanned: mocks.setLookTagBanned,
  renameLookTag: mocks.renameLookTag,
  mergeLookTags: mocks.mergeLookTags,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

import { POST } from './route'

function ctx(slug = 'balayage') {
  return { params: Promise.resolve({ slug }) }
}

function post(body: unknown, slug = 'balayage') {
  return POST(
    new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ctx(slug),
  )
}

const TAG = {
  slug: 'balayage',
  display: 'Balayage',
  lookCount: 5,
  banned: true,
  bannedAt: '2026-07-07T12:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
  mocks.requireAdminPermission.mockResolvedValue({ ok: true })
  mocks.setLookTagBanned.mockResolvedValue({ ok: true, tag: TAG })
  mocks.renameLookTag.mockResolvedValue({ ok: true, tag: { ...TAG, banned: false, bannedAt: null } })
  mocks.mergeLookTags.mockResolvedValue({
    ok: true,
    tag: { ...TAG, slug: 'blonde', display: 'Blonde', banned: false, bannedAt: null },
    movedLookCount: 3,
  })
})

describe('POST /api/v1/admin/look-tags/[slug]', () => {
  it('requires SUPER_ADMIN', async () => {
    await post({ action: 'ban' })
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: ['SUPER_ADMIN'],
    })
  })

  it('bans a tag and audits it', async () => {
    const res = await post({ action: 'ban' })
    expect(res.status).toBe(200)
    expect(mocks.setLookTagBanned).toHaveBeenCalledWith({
      slug: 'balayage',
      banned: true,
      now: expect.any(Date),
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOOK_TAG_BANNED', targetId: 'balayage' }),
    )
  })

  it('renames a tag display', async () => {
    const res = await post({ action: 'rename', display: 'BaLaYaGe' })
    expect(res.status).toBe(200)
    expect(mocks.renameLookTag).toHaveBeenCalledWith({
      slug: 'balayage',
      display: 'BaLaYaGe',
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOOK_TAG_RENAMED' }),
    )
  })

  it('merges a tag and reports the moved count', async () => {
    const res = await post({ action: 'merge', targetSlug: 'blonde' })
    const json = (await res.json()) as { ok: boolean; movedLookCount: number }
    expect(res.status).toBe(200)
    expect(json.movedLookCount).toBe(3)
    expect(mocks.mergeLookTags).toHaveBeenCalledWith({
      fromSlug: 'balayage',
      toSlug: 'blonde',
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOOK_TAG_MERGED' }),
    )
  })

  it('propagates a service NOT_FOUND as a 404 without auditing', async () => {
    mocks.setLookTagBanned.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Tag not found.',
    })
    const res = await post({ action: 'ban' })
    expect(res.status).toBe(404)
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('400s an unknown action', async () => {
    const res = await post({ action: 'explode' })
    expect(res.status).toBe(400)
  })
})
