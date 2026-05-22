import { AdminPermissionRole, Role } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const document = {
  id: 'doc_1',
  professionalId: 'pro_1',
  url: 'supabase://media-private/verification/pro_1/license.jpg',
  imageUrl: null,
}

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAdminPermission: vi.fn(),
  jsonFail: vi.fn(),

  verificationDocumentFindUnique: vi.fn(),

  parseSupabasePointer: vi.fn(),
  safeUrl: vi.fn(),

  getSupabaseAdmin: vi.fn(),
  createSignedUrl: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/auth/requireUser', () => ({
  requireUser: mocks.requireUser,
}))

vi.mock('@/app/api/_utils/auth/requireAdminPermission', () => ({
  requireAdminPermission: mocks.requireAdminPermission,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationDocument: {
      findUnique: mocks.verificationDocumentFindUnique,
    },
  },
}))

vi.mock('@/lib/media', () => ({
  parseSupabasePointer: mocks.parseSupabasePointer,
  safeUrl: mocks.safeUrl,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

import { GET } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeGetRequest(id = 'doc_1'): Request {
  return new Request(
    `http://localhost/api/admin/verification-docs/open?id=${encodeURIComponent(
      id,
    )}`,
    {
      method: 'GET',
    },
  )
}

describe('app/api/admin/verification-docs/open/route.ts', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.requireUser.mockResolvedValue({
      ok: true,
      user: {
        id: 'admin_user_1',
        role: Role.ADMIN,
      },
    })

    mocks.requireAdminPermission.mockResolvedValue({
      ok: true,
      role: AdminPermissionRole.REVIEWER,
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.verificationDocumentFindUnique.mockResolvedValue(document)

    mocks.parseSupabasePointer.mockImplementation((value: unknown) => {
      if (value !== document.url) return null

      return {
        bucket: 'media-private',
        path: 'verification/pro_1/license.jpg',
      }
    })

    mocks.safeUrl.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      if (!value.startsWith('http://') && !value.startsWith('https://')) {
        return null
      }

      return value
    })

    mocks.createSignedUrl.mockResolvedValue({
      data: {
        signedUrl: 'https://signed.example/verification/pro_1/license.jpg',
      },
      error: null,
    })

    mocks.getSupabaseAdmin.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mocks.createSignedUrl,
        })),
      },
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns auth response when requireUser fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requireUser.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await GET(makeGetRequest())

    expect(result).toBe(authRes)
    expect(mocks.verificationDocumentFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('requires admin role through requireUser', async () => {
    await GET(makeGetRequest())

    expect(mocks.requireUser).toHaveBeenCalledWith({
      roles: [Role.ADMIN],
    })
  })

  it('returns 400 when id is missing', async () => {
    const result = await GET(
      new Request('http://localhost/api/admin/verification-docs/open', {
        method: 'GET',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing id.',
    })

    expect(mocks.verificationDocumentFindUnique).not.toHaveBeenCalled()
    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('returns 404 when document is not found', async () => {
    mocks.verificationDocumentFindUnique.mockResolvedValueOnce(null)

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Document not found.',
    })

    expect(mocks.requireAdminPermission).not.toHaveBeenCalled()
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('checks scoped admin permission before signing the document URL', async () => {
    await GET(makeGetRequest())

    expect(mocks.verificationDocumentFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'doc_1',
      },
      select: {
        id: true,
        professionalId: true,
        url: true,
        imageUrl: true,
      },
    })

    expect(mocks.requireAdminPermission).toHaveBeenCalledWith({
      adminUserId: 'admin_user_1',
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
        AdminPermissionRole.SUPPORT,
      ],
      scope: {
        professionalId: 'pro_1',
      },
    })
  })

  it('returns permission response when scoped admin permission fails', async () => {
    const permissionRes = makeJsonResponse(403, {
      ok: false,
      error: 'Forbidden',
    })

    mocks.requireAdminPermission.mockResolvedValueOnce({
      ok: false,
      res: permissionRes,
    })

    const result = await GET(makeGetRequest())

    expect(result).toBe(permissionRes)
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('returns 404 when document has no URL', async () => {
    mocks.verificationDocumentFindUnique.mockResolvedValueOnce({
      ...document,
      url: null,
      imageUrl: null,
    })

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Document has no URL.',
    })

    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('uses imageUrl fallback when url is missing', async () => {
    const imageUrl = 'supabase://media-private/verification/pro_1/id-card.jpg'

    mocks.verificationDocumentFindUnique.mockResolvedValueOnce({
      ...document,
      url: null,
      imageUrl,
    })

    mocks.parseSupabasePointer.mockImplementationOnce((value: unknown) => {
      expect(value).toBe(imageUrl)

      return {
        bucket: 'media-private',
        path: 'verification/pro_1/id-card.jpg',
      }
    })

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe(
      'https://signed.example/verification/pro_1/license.jpg',
    )

    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      'verification/pro_1/id-card.jpg',
      60 * 10,
    )
  })

  it('rejects unsupported non-supabase URLs', async () => {
    mocks.verificationDocumentFindUnique.mockResolvedValueOnce({
      ...document,
      url: 'https://example.com/license.jpg',
      imageUrl: null,
    })

    mocks.parseSupabasePointer.mockReturnValueOnce(null)

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Unsupported document URL format.',
    })

    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('rejects media-public verification document pointers', async () => {
    mocks.parseSupabasePointer.mockReturnValueOnce({
      bucket: 'media-public',
      path: 'verification/pro_1/license.jpg',
    })

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid document bucket.',
    })

    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
  })

  it('redirects to signed private Supabase URL for authorized admin', async () => {
    const result = await GET(makeGetRequest())

    expect(mocks.getSupabaseAdmin).toHaveBeenCalled()
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      'verification/pro_1/license.jpg',
      60 * 10,
    )

    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe(
      'https://signed.example/verification/pro_1/license.jpg',
    )
  })

  it('returns generic 500 and logs structured metadata when Supabase signing fails', async () => {
    mocks.createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: {
        name: 'StorageError',
        message: 'storage unavailable',
      },
    })

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to sign URL.',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'GET /api/admin/verification-docs/open sign error',
      {
        errorName: 'StorageError',
        errorMessage: 'storage unavailable',
      },
    )
  })

  it('returns 500 when signed URL is missing', async () => {
    mocks.createSignedUrl.mockResolvedValueOnce({
      data: {},
      error: null,
    })

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Signed URL missing.',
    })
  })

  it('returns 500 and logs structured metadata without leaking unexpected errors to the response', async () => {
    mocks.verificationDocumentFindUnique.mockRejectedValueOnce(
      new Error('database exploded'),
    )

    const result = await GET(makeGetRequest())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'GET /api/admin/verification-docs/open error',
      {
        errorName: 'Error',
        errorMessage: 'database exploded',
      },
    )
  })
})