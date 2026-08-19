// app/api/v1/admin/viral-service-requests/[id]/media/route.test.ts
//
// The ROUTE, not the helper underneath it — `removeViralRequestMedia`'s own
// rules are pinned in lib/viralRequests/index.test.ts. What is only decidable
// here: who may call it, and what happens when the bucket delete fails after the
// row has already been written.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPermissionRole, Role } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>, init?: number | ResponseInit) => {
    const status = typeof init === 'number' ? init : init?.status
    return Response.json({ ok: true, ...(data ?? {}) }, { status: status ?? 200 })
  }),
  jsonFail: vi.fn(
    (status: number, error: string, extra?: Record<string, unknown>) =>
      Response.json({ ok: false, error, ...(extra ?? {}) }, { status }),
  ),
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  removeViralRequestMedia: vi.fn(),
  toViralRequestDto: vi.fn(() => ({ id: 'request_1' })),
  writeAdminAuditLog: vi.fn(async () => null),
  // Typed explicitly: inferring from `{ error: null }` pins the mock to `null`
  // and the storage-failure case below cannot then be expressed.
  remove: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
  from: vi.fn(),
  prisma: {
    viralServiceRequest: { findUnique: vi.fn() },
  },
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))
vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))
vi.mock('@/app/api/_utils/auth/requireAdminPermission', () => ({
  requireAdminPermission: mocks.requireAdminPermission,
}))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ storage: { from: mocks.from } }),
}))
vi.mock('@/lib/viralRequests', () => ({
  removeViralRequestMedia: mocks.removeViralRequestMedia,
}))
vi.mock('@/lib/viralRequests/contracts', () => ({
  toViralRequestDto: mocks.toViralRequestDto,
}))

import { DELETE } from './route'

const SUPABASE_URL = 'https://project.supabase.co'
const MEDIA_URL = `${SUPABASE_URL}/storage/v1/object/public/media-public/viral-requests/request_1/uploads/inspo.jpg`
const STORAGE_PATH = 'viral-requests/request_1/uploads/inspo.jpg'

function makeDeleteRequest(
  body: unknown = { mediaUrl: MEDIA_URL },
  init?: { contentType?: string | null },
) {
  const headers: Record<string, string> = {}
  const contentType =
    init && 'contentType' in init ? init.contentType : 'application/json'
  if (contentType) headers['content-type'] = contentType

  return new Request(
    'http://localhost/api/v1/admin/viral-service-requests/request_1/media',
    {
      method: 'DELETE',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  )
}

const ctx = { params: { id: 'request_1' } }

describe('DELETE /api/v1/admin/viral-service-requests/[id]/media', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: { id: 'admin_1', role: Role.ADMIN },
    })
    mocks.requireAdminPermission.mockResolvedValue({ ok: true })
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })
    mocks.removeViralRequestMedia.mockResolvedValue({
      ok: true,
      request: { id: 'request_1' },
      storagePath: STORAGE_PATH,
      clearedCover: false,
    })
    mocks.remove.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ remove: mocks.remove })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('removes the row entry and then the object', async () => {
    const res = await DELETE(makeDeleteRequest(), ctx)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      clearedCover: false,
      storageRemoved: true,
    })

    expect(mocks.removeViralRequestMedia).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        requestId: 'request_1',
        mediaUrl: MEDIA_URL,
        supabaseBaseUrl: SUPABASE_URL,
      }),
    )
    expect(mocks.from).toHaveBeenCalledWith('media-public')
    expect(mocks.remove).toHaveBeenCalledWith([STORAGE_PATH])
  })

  // 🔴 The permission bar. Removing an attachment is the destructive twin of
  // promoting one, so it must not be reachable by a role that cannot promote —
  // SUPPORT can read this queue and must not be able to delete from it.
  it('requires SUPER_ADMIN or REVIEWER, scoped to the request category', async () => {
    await DELETE(makeDeleteRequest(), ctx)

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: { categoryId: 'cat_1' },
    })
  })

  it('does not write or delete when the permission check refuses', async () => {
    mocks.requireAdminPermission.mockResolvedValue({
      ok: false,
      res: Response.json({ ok: false }, { status: 403 }),
    })

    const res = await DELETE(makeDeleteRequest(), ctx)

    expect(res.status).toBe(403)
    expect(mocks.removeViralRequestMedia).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('404s an unknown request before checking any permission', async () => {
    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(null)

    const res = await DELETE(makeDeleteRequest(), ctx)

    expect(res.status).toBe(404)
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.removeViralRequestMedia).not.toHaveBeenCalled()
  })

  // 🔴 The ordering that matters. The row is already clean by the time the
  // bucket is touched, so a storage failure must NOT fail the request and must
  // NOT be retried into a rollback — an orphaned object nobody references is
  // invisible, whereas re-adding the URL would point a live row at bytes that
  // may or may not still exist. It is reported instead.
  it('still succeeds, and says so, when the object delete fails', async () => {
    mocks.remove.mockResolvedValue({ error: new Error('bucket exploded') })

    const res = await DELETE(makeDeleteRequest(), ctx)

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      storageRemoved: false,
    })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ storageRemoved: false }),
      }),
    )
  })

  it('reports a cleared cover so the reviewer is told the look lost its picture', async () => {
    mocks.removeViralRequestMedia.mockResolvedValue({
      ok: true,
      request: { id: 'request_1' },
      storagePath: STORAGE_PATH,
      clearedCover: true,
    })

    const res = await DELETE(makeDeleteRequest(), ctx)

    await expect(res.json()).resolves.toMatchObject({ clearedCover: true })
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIRAL_REQUEST_MEDIA_REMOVED',
        metadata: expect.objectContaining({ clearedCover: true }),
      }),
    )
  })

  it.each([
    ['MEDIA_NOT_ATTACHED', 404],
    ['INVALID_MEDIA_URL', 400],
    ['NOT_FOUND', 404],
  ])('maps %s to %i and touches no bytes', async (reason, status) => {
    mocks.removeViralRequestMedia.mockResolvedValue({ ok: false, reason })

    const res = await DELETE(makeDeleteRequest(), ctx)

    expect(res.status).toBe(status)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body', async () => {
    const res = await DELETE(
      makeDeleteRequest({ mediaUrl: MEDIA_URL }, { contentType: 'text/plain' }),
      ctx,
    )

    expect(res.status).toBe(415)
    expect(mocks.removeViralRequestMedia).not.toHaveBeenCalled()
  })

  it('rejects a missing mediaUrl', async () => {
    const res = await DELETE(makeDeleteRequest({}), ctx)

    expect(res.status).toBe(400)
    expect(mocks.removeViralRequestMedia).not.toHaveBeenCalled()
  })

  it('refuses a non-admin before reading anything', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      res: Response.json({ ok: false }, { status: 403 }),
    })

    const res = await DELETE(makeDeleteRequest(), ctx)

    expect(res.status).toBe(403)
    expect(mocks.prisma.viralServiceRequest.findUnique).not.toHaveBeenCalled()
    expect(mocks.removeViralRequestMedia).not.toHaveBeenCalled()
  })
})
