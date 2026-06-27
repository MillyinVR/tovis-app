import { VerificationStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  verificationDocumentFindUnique: vi.fn(),
  verificationDocumentDelete: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationDocument: {
      findUnique: mocks.verificationDocumentFindUnique,
      delete: mocks.verificationDocumentDelete,
    },
  },
}))

import { DELETE } from './route'

type TestCtx = { params: Promise<{ id: string }> }

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makeDeleteRequest(id = 'doc_1'): Request {
  return new Request(`http://localhost/api/v1/pro/verification-docs/${id}`, {
    method: 'DELETE',
  })
}

function makeCtx(id = 'doc_1'): TestCtx {
  return {
    params: Promise.resolve({ id }),
  }
}

describe('app/api/v1/pro/verification-docs/[id]/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: {
        id: 'user_1',
      },
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, {
        ok: false,
        error,
      }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, {
          ok: true,
          ...(data ?? {}),
        }),
    )

    mocks.verificationDocumentFindUnique.mockResolvedValue({
      id: 'doc_1',
      professionalId: 'pro_1',
      status: VerificationStatus.PENDING,
    })

    mocks.verificationDocumentDelete.mockResolvedValue({
      id: 'doc_1',
    })
  })

  it('returns auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, {
      ok: false,
      error: 'Unauthorized',
    })

    mocks.requirePro.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result).toBe(authRes)
    expect(mocks.verificationDocumentFindUnique).not.toHaveBeenCalled()
    expect(mocks.verificationDocumentDelete).not.toHaveBeenCalled()
  })

  it('rejects missing id', async () => {
    const result = await DELETE(makeDeleteRequest(''), makeCtx(''))

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing id.',
    })

    expect(mocks.verificationDocumentDelete).not.toHaveBeenCalled()
  })

  it('returns 404 when the document does not exist', async () => {
    mocks.verificationDocumentFindUnique.mockResolvedValueOnce(null)

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Not found.',
    })

    expect(mocks.verificationDocumentDelete).not.toHaveBeenCalled()
  })

  it('returns 403 when the document belongs to another professional', async () => {
    mocks.verificationDocumentFindUnique.mockResolvedValueOnce({
      id: 'doc_1',
      professionalId: 'pro_other',
      status: VerificationStatus.PENDING,
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(403)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Forbidden.',
    })

    expect(mocks.verificationDocumentDelete).not.toHaveBeenCalled()
  })

  it.each([
    VerificationStatus.APPROVED,
    VerificationStatus.REJECTED,
    VerificationStatus.NEEDS_INFO,
    VerificationStatus.PENDING_MANUAL_REVIEW,
  ])('returns 409 for %s documents', async (status) => {
    mocks.verificationDocumentFindUnique.mockResolvedValueOnce({
      id: 'doc_1',
      professionalId: 'pro_1',
      status,
    })

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(409)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Only pending documents can be removed.',
    })

    expect(mocks.verificationDocumentDelete).not.toHaveBeenCalled()
  })

  it('deletes a pending document owned by the authenticated professional', async () => {
    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(mocks.verificationDocumentFindUnique).toHaveBeenCalledWith({
      where: { id: 'doc_1' },
      select: { id: true, professionalId: true, status: true },
    })

    expect(mocks.verificationDocumentDelete).toHaveBeenCalledWith({
      where: { id: 'doc_1' },
    })

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
    })
  })

  it('returns 500 and does not leak unexpected errors', async () => {
    mocks.verificationDocumentFindUnique.mockRejectedValueOnce(
      new Error('database exploded'),
    )

    const result = await DELETE(makeDeleteRequest(), makeCtx())

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to delete document.',
    })
  })
})
