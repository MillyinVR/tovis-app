// app/api/v1/admin/uploads/route.test.ts
//
// The promote path had no coverage at all until this file: nothing exercised
// `VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE`, the one write that puts a picture
// on every client surface. See [[untestable-surface-is-where-gaps-survive]].
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  hasAdminPermission: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  setViralRequestCoverImage: vi.fn(),
  getStorageEnvironmentMismatch: vi.fn(),
  findUnique: vi.fn(),
  storageFrom: vi.fn(),
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/lib/adminPermissions', () => ({
  hasAdminPermission: mocks.hasAdminPermission,
}))

vi.mock('@/lib/admin/auditLog', () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}))

vi.mock('@/lib/media/storageEnvironment', () => ({
  getStorageEnvironmentMismatch: mocks.getStorageEnvironmentMismatch,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    viralServiceRequest: { findUnique: mocks.findUnique },
  },
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ storage: { from: mocks.storageFrom } }),
}))

// 🔴 Partial mock on purpose: `isViralRequestCoverCandidateUrl` is the thing
// under test here, so it must be the REAL implementation. Only the write is
// stubbed.
vi.mock('@/lib/viralRequests', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/viralRequests')>()

  return {
    ...actual,
    setViralRequestCoverImage: mocks.setViralRequestCoverImage,
  }
})

import { POST } from './route'

const BASE = 'https://project.supabase.co'
const PUBLIC_ROOT = `${BASE}/storage/v1/object/public/media-public/viral-requests`

const SUBMITTER_ATTACHMENT = `${PUBLIC_ROOT}/request_1/uploads/inspo.jpg`
const REVIEWER_FRAME = `${PUBLIC_ROOT}/request_1/cover.jpg`

// Construct a real NextRequest rather than casting a plain Request through a
// double assertion — the house rule bans those, and the constructor is public.
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/admin/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function finalizeBody(publicUrl: string | null) {
  return publicUrl === null
    ? {
        kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE',
        requestId: 'request_1',
        clear: true,
      }
    : {
        kind: 'VIRAL_REQUEST_COVER_IMAGE_PUBLIC_FINALIZE',
        requestId: 'request_1',
        publicUrl,
      }
}

describe('app/api/v1/admin/uploads/route.ts — viral cover finalize', () => {
  const originalBase = process.env.NEXT_PUBLIC_SUPABASE_URL

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE

    mocks.requireUser.mockResolvedValue({ ok: true, user: { id: 'admin_1' } })
    mocks.hasAdminPermission.mockResolvedValue(true)
    mocks.getStorageEnvironmentMismatch.mockReturnValue(null)
    mocks.findUnique.mockResolvedValue({
      id: 'request_1',
      requestedCategoryId: 'cat_1',
    })
    mocks.setViralRequestCoverImage.mockResolvedValue(undefined)
    mocks.writeAdminAuditLog.mockResolvedValue(undefined)
    mocks.storageFrom.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
    })
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalBase
  })

  it('promotes a submitter attachment this server minted for THIS request', async () => {
    const res = await POST(makeRequest(finalizeBody(SUBMITTER_ATTACHMENT)))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.coverImageUrl).toBe(SUBMITTER_ATTACHMENT)
    expect(mocks.setViralRequestCoverImage).toHaveBeenCalledWith(
      expect.anything(),
      { requestId: 'request_1', coverImageUrl: SUBMITTER_ATTACHMENT },
    )
  })

  it('accepts the reviewer’s own uploaded frame', async () => {
    const res = await POST(makeRequest(finalizeBody(REVIEWER_FRAME)))

    expect(res.status).toBe(200)
    expect(mocks.setViralRequestCoverImage).toHaveBeenCalled()
  })

  it('still clears the cover back to the gradient', async () => {
    const res = await POST(makeRequest(finalizeBody(null)))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.coverImageUrl).toBeNull()
    expect(mocks.setViralRequestCoverImage).toHaveBeenCalledWith(
      expect.anything(),
      { requestId: 'request_1', coverImageUrl: null },
    )
  })

  it.each([
    ['a host the submitter controls', 'https://evil.example/pretty.jpg'],
    [
      'a foreign host wearing our path',
      'https://evil.example/storage/v1/object/public/media-public/viral-requests/request_1/cover.jpg',
    ],
    ['another request’s object', `${PUBLIC_ROOT}/request_2/cover.jpg`],
    [
      'the private bucket',
      `${BASE}/storage/v1/object/public/media-private/viral-requests/request_1/cover.jpg`,
    ],
    [
      'something else parked in the request folder',
      `${PUBLIC_ROOT}/request_1/anything.jpg`,
    ],
  ])(
    '🔴 REFUSES %s — and writes nothing',
    async (_label, url) => {
      const res = await POST(makeRequest(finalizeBody(url)))

      expect(res.status).toBe(400)
      // The write is what publishes app-wide; a refusal that still wrote would
      // be no refusal at all.
      expect(mocks.setViralRequestCoverImage).not.toHaveBeenCalled()
      expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled()
    },
  )

  it('refuses before the scope check can be bypassed by a non-reviewer', async () => {
    mocks.hasAdminPermission.mockResolvedValue(false)

    const res = await POST(makeRequest(finalizeBody(SUBMITTER_ATTACHMENT)))

    expect(res.status).toBe(403)
    expect(mocks.setViralRequestCoverImage).not.toHaveBeenCalled()
  })

  it('404s a request that does not exist rather than leaking it through a 403', async () => {
    mocks.findUnique.mockResolvedValue(null)

    const res = await POST(makeRequest(finalizeBody(SUBMITTER_ATTACHMENT)))

    expect(res.status).toBe(404)
    expect(mocks.setViralRequestCoverImage).not.toHaveBeenCalled()
  })
})
