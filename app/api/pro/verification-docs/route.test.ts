import {
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),

  transaction: vi.fn(),
  txVerificationDocumentCreate: vi.fn(),
  txProfessionalProfileFindUnique: vi.fn(),
  txProfessionalProfileUpdate: vi.fn(),

  emitAdminVerificationReviewNeeded: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/notifications/adminNotifications', () => ({
  emitAdminVerificationReviewNeeded: mocks.emitAdminVerificationReviewNeeded,
}))

import { POST } from './route'

type TxForVerificationDocs = {
  verificationDocument: {
    create: typeof mocks.txVerificationDocumentCreate
  }
  professionalProfile: {
    findUnique: typeof mocks.txProfessionalProfileFindUnique
    update: typeof mocks.txProfessionalProfileUpdate
  }
}

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/pro/verification-docs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

const validBody = {
  type: 'LICENSE',
  url: 'supabase://media-private/verification/pro_1/license.jpg',
  label: 'Cosmetology license',
}

describe('app/api/pro/verification-docs/route.ts', () => {
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

    mocks.txVerificationDocumentCreate.mockResolvedValue({
      id: 'verification_doc_1',
    })

    mocks.txProfessionalProfileFindUnique.mockResolvedValue({
      verificationStatus: VerificationStatus.PENDING,
    })

    mocks.txProfessionalProfileUpdate.mockResolvedValue({
      id: 'pro_1',
    })

    mocks.transaction.mockImplementation(
      async (fn: (tx: TxForVerificationDocs) => Promise<unknown>) =>
        fn({
          verificationDocument: {
            create: mocks.txVerificationDocumentCreate,
          },
          professionalProfile: {
            findUnique: mocks.txProfessionalProfileFindUnique,
            update: mocks.txProfessionalProfileUpdate,
          },
        }),
    )
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

    const result = await POST(makePostRequest(validBody))

    expect(result).toBe(authRes)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid document type', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'BANANA',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid document type.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('accepts LICENSE document type', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'LICENSE',
      }),
    )

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      id: 'verification_doc_1',
    })

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.LICENSE,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/license.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('accepts ID document type and stores it as ID_CARD', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'ID',
        url: 'supabase://media-private/verification/pro_1/id-card.jpg',
      }),
    )

    expect(result.status).toBe(201)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.ID_CARD,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/id-card.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('accepts canonical ID_CARD document type', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'ID_CARD',
        url: 'supabase://media-private/verification/pro_1/id-card.jpg',
      }),
    )

    expect(result.status).toBe(201)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.ID_CARD,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/id-card.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('accepts canonical MAKEUP_PRIMARY document type', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'MAKEUP_PRIMARY',
        url: 'supabase://media-private/verification/pro_1/cert.jpg',
      }),
    )

    expect(result.status).toBe(201)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.MAKEUP_PRIMARY,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/cert.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('accepts canonical MAKEUP_SECONDARY document type', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'makeup_secondary',
        url: 'supabase://media-private/verification/pro_1/cert-2.jpg',
      }),
    )

    expect(result.status).toBe(201)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.MAKEUP_SECONDARY,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/cert-2.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('accepts OTHER document type and stores it as MAKEUP_PRIMARY', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        type: 'OTHER',
        url: 'supabase://media-private/verification/pro_1/other.jpg',
      }),
    )

    expect(result.status).toBe(201)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.MAKEUP_PRIMARY,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/other.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('rejects missing url', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        url: '   ',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Missing url.',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('rejects raw public https url', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        url: 'https://example.com/license.jpg',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid document url (expected supabase://bucket/path).',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('rejects malformed supabase url without path', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        url: 'supabase://media-private',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid document url (expected supabase://bucket/path).',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('rejects empty bucket in supabase url', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        url: 'supabase:///verification/pro_1/license.jpg',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid document url (expected supabase://bucket/path).',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('rejects media-public bucket for verification docs', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        url: 'supabase://media-public/verification/pro_1/license.jpg',
      }),
    )

    expect(result.status).toBe(400)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid document bucket (must be media-private).',
    })

    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txVerificationDocumentCreate).not.toHaveBeenCalled()
  })

  it('trims document label and stores null when label is blank', async () => {
    const result = await POST(
      makePostRequest({
        ...validBody,
        label: '   ',
      }),
    )

    expect(result.status).toBe(201)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.LICENSE,
        label: null,
        url: 'supabase://media-private/verification/pro_1/license.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('creates a pending verification document for the authenticated professional', async () => {
    const result = await POST(makePostRequest(validBody))

    expect(mocks.transaction).toHaveBeenCalledTimes(1)

    expect(mocks.txVerificationDocumentCreate).toHaveBeenCalledWith({
      data: {
        professionalId: 'pro_1',
        type: VerificationDocumentType.LICENSE,
        label: 'Cosmetology license',
        url: 'supabase://media-private/verification/pro_1/license.jpg',
        status: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })

    expect(mocks.txProfessionalProfileFindUnique).toHaveBeenCalledWith({
      where: {
        id: 'pro_1',
      },
      select: {
        verificationStatus: true,
      },
    })

    expect(mocks.txProfessionalProfileUpdate).not.toHaveBeenCalled()

    expect(result.status).toBe(201)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      id: 'verification_doc_1',
    })
  })

  it('moves rejected professional verification status back to pending after upload', async () => {
    mocks.txProfessionalProfileFindUnique.mockResolvedValueOnce({
      verificationStatus: VerificationStatus.REJECTED,
    })

    const result = await POST(makePostRequest(validBody))

    expect(result.status).toBe(201)

    expect(mocks.txProfessionalProfileUpdate).toHaveBeenCalledWith({
      where: {
        id: 'pro_1',
      },
      data: {
        verificationStatus: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('moves needs-info professional verification status back to pending after upload', async () => {
    mocks.txProfessionalProfileFindUnique.mockResolvedValueOnce({
      verificationStatus: VerificationStatus.NEEDS_INFO,
    })

    const result = await POST(makePostRequest(validBody))

    expect(result.status).toBe(201)

    expect(mocks.txProfessionalProfileUpdate).toHaveBeenCalledWith({
      where: {
        id: 'pro_1',
      },
      data: {
        verificationStatus: VerificationStatus.PENDING,
      },
      select: {
        id: true,
      },
    })
  })

  it('returns 500 and does not leak unexpected errors', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('database exploded'))

    const result = await POST(makePostRequest(validBody))

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})