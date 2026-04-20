import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientActionTokenKind,
  ConsultationApprovalStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn(),
  jsonFail: vi.fn(),
  pickString: vi.fn(),

  prismaClientActionTokenFindUnique: vi.fn(),

  hashClientActionToken: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonOk: mocks.jsonOk,
  jsonFail: mocks.jsonFail,
  pickString: mocks.pickString,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientActionToken: {
      findUnique: mocks.prismaClientActionTokenFindUnique,
    },
  },
}))

vi.mock('@/lib/consultation/clientActionTokens', () => ({
  hashClientActionToken: mocks.hashClientActionToken,
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

function makeCtx(token = 'token_1') {
  return {
    params: Promise.resolve({ token }),
  }
}

function makePublicConsultationToken(overrides?: {
  kind?: ClientActionTokenKind
  approvalStatus?: ConsultationApprovalStatus
  expiresAt?: Date
  firstUsedAt?: Date | null
  revokedAt?: Date | null
  proof?: Record<string, unknown> | null
  deliveryMethod?: 'EMAIL' | 'SMS' | null
  recipientEmailSnapshot?: string | null
  recipientPhoneSnapshot?: string | null
  singleUse?: boolean
}) {
  return {
    id: 'token_row_1',
    kind: overrides?.kind ?? ClientActionTokenKind.CONSULTATION_ACTION,
    singleUse: overrides?.singleUse ?? true,
    bookingId: 'booking_1',
    consultationApprovalId: 'approval_1',
    clientId: 'client_1',
    professionalId: 'pro_1',
    deliveryMethod: overrides?.deliveryMethod ?? 'EMAIL',
    recipientEmailSnapshot:
      overrides?.recipientEmailSnapshot ?? 'client@example.com',
    recipientPhoneSnapshot: overrides?.recipientPhoneSnapshot ?? null,
    expiresAt: overrides?.expiresAt ?? new Date('2026-04-20T18:00:00.000Z'),
    firstUsedAt: overrides?.firstUsedAt ?? null,
    lastUsedAt: null,
    useCount: 0,
    revokedAt: overrides?.revokedAt ?? null,
    revokeReason: overrides?.revokedAt ? 'revoked for test' : null,
    booking: {
      id: 'booking_1',
      status: 'ACCEPTED',
      sessionStep: 'CONSULTATION_PENDING_CLIENT',
      scheduledFor: new Date('2026-04-22T18:00:00.000Z'),
      startedAt: null,
      finishedAt: null,
      locationType: 'SALON',
      service: {
        id: 'service_1',
        name: 'Haircut',
      },
      client: {
        id: 'client_1',
        firstName: 'Tori',
        lastName: 'Morales',
        claimStatus: 'UNCLAIMED',
      },
      professional: {
        id: 'pro_1',
        businessName: 'TOVIS Studio',
        timeZone: 'America/Los_Angeles',
      },
    },
    consultationApproval: {
      id: 'approval_1',
      status: overrides?.approvalStatus ?? ConsultationApprovalStatus.PENDING,
      proposedServicesJson: {
        currency: 'USD',
        items: [
          {
            offeringId: 'off_1',
            name: 'Haircut',
            sortOrder: 0,
          },
        ],
      },
      proposedTotal: '125.00',
      notes: 'Please review and confirm.',
      createdAt: new Date('2026-04-12T16:00:00.000Z'),
      updatedAt: new Date('2026-04-12T17:00:00.000Z'),
      approvedAt:
        (overrides?.approvalStatus ?? ConsultationApprovalStatus.PENDING) ===
        ConsultationApprovalStatus.APPROVED
          ? new Date('2026-04-12T18:00:00.000Z')
          : null,
      rejectedAt:
        (overrides?.approvalStatus ?? ConsultationApprovalStatus.PENDING) ===
        ConsultationApprovalStatus.REJECTED
          ? new Date('2026-04-12T18:00:00.000Z')
          : null,
      clientId: null,
      proId: null,
      proof: overrides?.proof ?? null,
    },
  }
}

describe('GET /api/public/consultation/[token]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'))

    vi.clearAllMocks()

    mocks.jsonOk.mockImplementation(
      (data: Record<string, unknown>, status = 200) =>
        makeJsonResponse(status, { ok: true, ...(data ?? {}) }),
    )

    mocks.jsonFail.mockImplementation(
      (
        status: number,
        error: string,
        extra?: Record<string, unknown>,
      ) => makeJsonResponse(status, { ok: false, error, ...(extra ?? {}) }),
    )

    mocks.pickString.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    })

    mocks.hashClientActionToken.mockImplementation(
      (rawToken: string) => `hashed:${rawToken}`,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns 404 when token is missing', async () => {
    const response = await GET(new Request('http://localhost/test'), makeCtx('   '))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Consultation link not found.',
      code: 'NOT_FOUND',
    })

    expect(mocks.hashClientActionToken).not.toHaveBeenCalled()
    expect(mocks.prismaClientActionTokenFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when token record is not found', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValueOnce(null)

    const response = await GET(new Request('http://localhost/test'), makeCtx('token_1'))

    expect(mocks.hashClientActionToken).toHaveBeenCalledWith('token_1')
    expect(mocks.prismaClientActionTokenFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hashed:token_1' },
      select: expect.any(Object),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Consultation link not found.',
      code: 'NOT_FOUND',
    })
  })

  it('returns 404 when the token exists but is not a consultation action token', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValueOnce(
      makePublicConsultationToken({
        kind: ClientActionTokenKind.AFTERCARE_ACCESS,
      }),
    )

    const response = await GET(new Request('http://localhost/test'), makeCtx('token_2'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Consultation link not found.',
      code: 'NOT_FOUND',
    })
  })

  it('returns the public consultation payload for a valid pending token', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValueOnce(
      makePublicConsultationToken(),
    )

    const response = await GET(new Request('http://localhost/test'), makeCtx('token_3'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      booking: {
        id: 'booking_1',
        status: 'ACCEPTED',
        sessionStep: 'CONSULTATION_PENDING_CLIENT',
        scheduledFor: '2026-04-22T18:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        locationType: 'SALON',
        service: {
          id: 'service_1',
          name: 'Haircut',
        },
        client: {
          id: 'client_1',
          firstName: 'Tori',
          lastName: 'Morales',
          claimStatus: 'UNCLAIMED',
        },
        professional: {
          id: 'pro_1',
          businessName: 'TOVIS Studio',
          timeZone: 'America/Los_Angeles',
        },
      },
      approval: {
        id: 'approval_1',
        status: ConsultationApprovalStatus.PENDING,
        proposedServicesJson: {
          currency: 'USD',
          items: [
            {
              offeringId: 'off_1',
              name: 'Haircut',
              sortOrder: 0,
            },
          ],
        },
        proposedTotal: '125.00',
        notes: 'Please review and confirm.',
        createdAt: '2026-04-12T16:00:00.000Z',
        updatedAt: '2026-04-12T17:00:00.000Z',
        approvedAt: null,
        rejectedAt: null,
        clientId: null,
        proId: null,
        proof: null,
      },
      token: {
        id: 'token_row_1',
        deliveryMethod: 'EMAIL',
        destinationSnapshot: 'client@example.com',
        expiresAt: '2026-04-20T18:00:00.000Z',
        firstUsedAt: null,
        lastUsedAt: null,
        useCount: 0,
        singleUse: true,
        revokedAt: null,
        revokeReason: null,
      },
      actionState: {
        canApproveOrReject: true,
        isExpired: false,
        isRevoked: false,
        isUsed: false,
        hasProof: false,
        isPending: true,
      },
    })
  })

  it('returns non-actionable state when the token is already used', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValueOnce(
      makePublicConsultationToken({
        firstUsedAt: new Date('2026-04-12T19:00:00.000Z'),
      }),
    )

    const response = await GET(new Request('http://localhost/test'), makeCtx('token_4'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      actionState: {
        canApproveOrReject: false,
        isUsed: true,
        isExpired: false,
        isRevoked: false,
        hasProof: false,
        isPending: true,
      },
    })
  })

  it('returns non-actionable state when proof already exists', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValueOnce(
      makePublicConsultationToken({
        proof: {
          id: 'proof_1',
          decision: 'APPROVED',
          method: 'REMOTE_SECURE_LINK',
          actedAt: new Date('2026-04-12T18:00:00.000Z'),
          recordedByUserId: null,
          clientActionTokenId: 'token_row_1',
          contactMethod: 'EMAIL',
          destinationSnapshot: 'client@example.com',
          ipAddress: '203.0.113.5',
          userAgent: 'Mozilla/5.0',
        },
      }),
    )

    const response = await GET(new Request('http://localhost/test'), makeCtx('token_5'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      approval: {
        proof: {
          id: 'proof_1',
          decision: 'APPROVED',
          method: 'REMOTE_SECURE_LINK',
          actedAt: '2026-04-12T18:00:00.000Z',
          recordedByUserId: null,
          clientActionTokenId: 'token_row_1',
          contactMethod: 'EMAIL',
          destinationSnapshot: 'client@example.com',
          ipAddress: '203.0.113.5',
          userAgent: 'Mozilla/5.0',
        },
      },
      actionState: {
        canApproveOrReject: false,
        hasProof: true,
      },
    })
  })
})