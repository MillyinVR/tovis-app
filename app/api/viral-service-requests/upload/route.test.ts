// app/api/viral-service-requests/upload/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViralServiceRequestStatus } from '@prisma/client'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  const createSignedUploadUrl = vi.fn()
  const from = vi.fn(() => ({
    createSignedUploadUrl,
  }))

  return {
    jsonOk: vi.fn(
      (data?: Record<string, unknown>, init?: number | ResponseInit) => {
        const status = typeof init === 'number' ? init : init?.status
        return Response.json(
          { ok: true, ...(data ?? {}) },
          { status: status ?? 200 },
        )
      },
    ),
    jsonFail: vi.fn(
      (
        status: number,
        error: string,
        extra?: Record<string, unknown>,
      ) => {
        return Response.json(
          { ok: false, error, ...(extra ?? {}) },
          { status },
        )
      },
    ),
    requireClient: vi.fn(),
    prisma: {
      viralServiceRequest: {
        findUnique: vi.fn(),
      },
    },
    buildViralRequestUploadTargetPath: vi.fn(),
    createSignedUploadUrl,
    from,
    getSupabaseAdmin: vi.fn(() => ({
      storage: {
        from,
      },
    })),
  }
})

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mocks.requireClient,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/viralRequests', () => ({
  buildViralRequestUploadTargetPath: mocks.buildViralRequestUploadTargetPath,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}))

import { POST } from './route'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

function makeJsonRequest(body: unknown): NextRequest {
  return asNextRequest(
    new Request('http://localhost/api/viral-service-requests/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

function makeRequestWithContentType(contentType: string, body = 'x'): NextRequest {
  return asNextRequest(
    new Request('http://localhost/api/viral-service-requests/upload', {
      method: 'POST',
      headers: {
        'content-type': contentType,
      },
      body,
    }),
  )
}

describe('app/api/viral-service-requests/upload/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  })

  it('passes through failed auth responses unchanged', async () => {
    const authRes = Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    )

    mocks.requireClient.mockResolvedValue({
      ok: false,
      res: authRes,
    })

    const res = await POST(makeJsonRequest({}))

    expect(res).toBe(authRes)
    expect(mocks.prisma.viralServiceRequest.findUnique).not.toHaveBeenCalled()
  })

  it('returns 500 when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(makeJsonRequest({}))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'NEXT_PUBLIC_SUPABASE_URL missing',
    })
  })

  it('returns 415 for non-json content type', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(makeRequestWithContentType('text/plain'))
    const body = await res.json()

    expect(res.status).toBe(415)
    expect(body).toEqual({
      ok: false,
      error: 'Content-Type must be application/json.',
    })
  })

  it('returns 400 when requestId is missing', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(
      makeJsonRequest({
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing requestId',
    })
  })

  it('returns 400 when fileName is missing', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing fileName',
    })
  })

  it('returns 400 when contentType is missing', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Missing contentType',
    })
  })

  it('returns 400 for unsupported mime types', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'notes.pdf',
        contentType: 'application/pdf',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'Only image/video uploads allowed',
    })
  })

  it('returns 400 for files over 30MB', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.mp4',
        contentType: 'video/mp4',
        size: 30 * 1024 * 1024 + 1,
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'File too large (max 30MB)',
    })
  })

  it('returns 404 when the viral request does not exist', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue(null)

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_404',
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(mocks.prisma.viralServiceRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 'request_404' },
      select: {
        id: true,
        clientId: true,
        status: true,
      },
    })

    expect(res.status).toBe(404)
    expect(body).toEqual({
      ok: false,
      error: 'Viral request not found.',
    })
  })

  it('returns 403 when the request belongs to a different client', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      clientId: 'client_2',
      status: ViralServiceRequestStatus.REQUESTED,
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({
      ok: false,
      error: 'Forbidden',
    })
  })

  it('returns 409 when the request is already finalized', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      clientId: 'client_1',
      status: ViralServiceRequestStatus.APPROVED,
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      ok: false,
      error: 'Cannot prepare uploads for a finalized viral request.',
    })
  })

  it('returns 400 when upload path generation rejects the input', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      clientId: 'client_1',
      status: ViralServiceRequestStatus.REQUESTED,
    })

    mocks.buildViralRequestUploadTargetPath.mockImplementation(() => {
      throw new Error('fileName is required.')
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({
      ok: false,
      error: 'fileName is required.',
    })
  })

  it('returns 500 when Supabase signed upload creation fails', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      clientId: 'client_1',
      status: ViralServiceRequestStatus.REQUESTED,
    })

    mocks.buildViralRequestUploadTargetPath.mockReturnValue(
      'viral-requests/request_1/uploads/wolf.png',
    )

    mocks.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(
      'viral-requests/request_1/uploads/wolf.png',
      { upsert: false },
    )

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'boom',
    })
  })

  it('returns 500 when Supabase does not return a token', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      clientId: 'client_1',
      status: ViralServiceRequestStatus.REQUESTED,
    })

    mocks.buildViralRequestUploadTargetPath.mockReturnValue(
      'viral-requests/request_1/uploads/wolf.png',
    )

    mocks.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/upload' },
      error: null,
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
        contentType: 'image/png',
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: 'Signed upload token missing',
    })
  })

  it('returns the signed upload contract on success', async () => {
    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: { id: 'user_1' },
    })

    mocks.prisma.viralServiceRequest.findUnique.mockResolvedValue({
      id: 'request_1',
      clientId: 'client_1',
      status: ViralServiceRequestStatus.REQUESTED,
    })

    mocks.buildViralRequestUploadTargetPath.mockReturnValue(
      'viral-requests/request_1/uploads/wolf.png',
    )

    mocks.createSignedUploadUrl.mockResolvedValue({
      data: {
        token: 'token_123',
        signedUrl: 'https://signed.example/upload',
      },
      error: null,
    })

    const res = await POST(
      makeJsonRequest({
        requestId: 'request_1',
        fileName: 'wolf.png',
        contentType: 'image/png',
        size: 1024,
      }),
    )
    const body = await res.json()

    expect(mocks.buildViralRequestUploadTargetPath).toHaveBeenCalledWith({
      requestId: 'request_1',
      fileName: 'wolf.png',
    })

    expect(mocks.from).toHaveBeenCalledWith('media-public')
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(
      'viral-requests/request_1/uploads/wolf.png',
      { upsert: false },
    )

    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      requestId: 'request_1',
      bucket: 'media-public',
      path: 'viral-requests/request_1/uploads/wolf.png',
      token: 'token_123',
      signedUrl: 'https://signed.example/upload',
      publicUrl:
        'https://example.supabase.co/storage/v1/object/public/media-public/viral-requests/request_1/uploads/wolf.png',
      isPublic: true,
    })
  })
})