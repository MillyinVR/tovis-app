import {
  ProfessionType,
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePro: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requirePro: mocks.requirePro,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    professionalProfile: {
      findUnique: mocks.findUnique,
    },
  },
}))

import { GET } from './route'

function makeJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const licensedProfile = {
  professionType: ProfessionType.COSMETOLOGIST,
  verificationStatus: VerificationStatus.PENDING,
  licenseState: 'CA',
  licenseNumber: 'COS123456',
  licenseExpiry: new Date('2027-03-15T00:00:00.000Z'),
  licenseVerified: false,
  verificationDocs: [
    {
      id: 'doc_1',
      type: VerificationDocumentType.LICENSE,
      status: VerificationStatus.PENDING,
      label: 'State license (pro upload)',
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      adminNote: null,
    },
  ],
}

describe('app/api/v1/pro/verification/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.requirePro.mockResolvedValue({
      ok: true,
      professionalId: 'pro_1',
      user: { id: 'user_1' },
    })

    mocks.jsonFail.mockImplementation((status: number, error: string) =>
      makeJsonResponse(status, { ok: false, error }),
    )

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )

    mocks.findUnique.mockResolvedValue(licensedProfile)
  })

  it('returns the auth response when requirePro fails', async () => {
    const authRes = makeJsonResponse(401, { ok: false, error: 'Unauthorized' })
    mocks.requirePro.mockResolvedValueOnce({ ok: false, res: authRes })

    const result = await GET()

    expect(result).toBe(authRes)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('404s when the professional profile is missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)

    const result = await GET()

    expect(result.status).toBe(404)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Professional profile not found.',
    })
  })

  it('returns status, license, methods and docs for a licensed pro', async () => {
    const result = await GET()

    expect(result.status).toBe(200)
    await expect(result.json()).resolves.toEqual({
      ok: true,
      verification: {
        status: VerificationStatus.PENDING,
        licenseVerified: false,
        isLicensed: true,
        license: {
          state: 'CA',
          number: 'COS123456',
          expiry: '2027-03-15',
        },
        methods: [
          {
            type: VerificationDocumentType.LICENSE,
            title: 'State license',
            description:
              'A clear photo of your current professional license or certification (front, readable).',
          },
          {
            type: VerificationDocumentType.ID_CARD,
            title: 'Government ID',
            description:
              'A government-issued photo ID (driver license, state ID, or passport).',
          },
        ],
        docs: [
          {
            id: 'doc_1',
            type: VerificationDocumentType.LICENSE,
            typeLabel: 'State license',
            status: VerificationStatus.PENDING,
            label: 'State license (pro upload)',
            createdAt: '2026-07-01T12:00:00.000Z',
            adminNote: null,
          },
        ],
      },
    })

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: 'pro_1' },
      select: expect.objectContaining({
        verificationStatus: true,
        licenseState: true,
        verificationDocs: expect.any(Object),
      }),
    })
  })

  it('marks a makeup artist as not licensed with makeup upload methods', async () => {
    mocks.findUnique.mockResolvedValueOnce({
      ...licensedProfile,
      professionType: ProfessionType.MAKEUP_ARTIST,
      licenseState: null,
      licenseNumber: null,
      licenseExpiry: null,
      verificationDocs: [],
    })

    const result = await GET()
    const body = (await result.json()) as {
      verification: {
        isLicensed: boolean
        license: { state: string | null; expiry: string | null }
        methods: { type: string }[]
        docs: unknown[]
      }
    }

    expect(body.verification.isLicensed).toBe(false)
    expect(body.verification.license.state).toBeNull()
    expect(body.verification.license.expiry).toBeNull()
    expect(body.verification.methods.map((m) => m.type)).toEqual([
      VerificationDocumentType.MAKEUP_PRIMARY,
      VerificationDocumentType.MAKEUP_SECONDARY,
      VerificationDocumentType.ID_CARD,
    ])
    expect(body.verification.docs).toEqual([])
  })

  it('500s without leaking internal errors', async () => {
    mocks.findUnique.mockRejectedValueOnce(new Error('db exploded'))

    const result = await GET()

    expect(result.status).toBe(500)
    await expect(result.json()).resolves.toEqual({
      ok: false,
      error: 'Internal server error',
    })
  })
})
