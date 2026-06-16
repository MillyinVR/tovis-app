// app/api/public/account-invite/[token]/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  jsonOk: vi.fn((data?: Record<string, unknown>) => ({ ok: true, ...data })),
  jsonFail: vi.fn((status: number, error: string, extra?: Record<string, unknown>) => ({
    ok: false,
    status,
    error,
    ...extra,
  })),
  pickString: vi.fn(),
  prismaClientActionTokenFindUnique: vi.fn(),
  hashClientActionToken: vi.fn(),
  issueClaimLinkForBooking: vi.fn(),
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

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  issueClaimLinkForBooking: mocks.issueClaimLinkForBooking,
}))

import { POST } from './route'

function makeCtx(token = 'token_1') {
  return { params: Promise.resolve({ token }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pickString.mockImplementation((v: unknown) =>
    typeof v === 'string' ? v : null,
  )
  mocks.hashClientActionToken.mockReturnValue('hash_1')
})

describe('POST /api/public/account-invite/[token]', () => {
  it('returns 404 when the token is missing', async () => {
    mocks.pickString.mockReturnValueOnce(null)

    const res = await POST(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(mocks.prismaClientActionTokenFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when no action token matches', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValue(null)

    const res = await POST(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(mocks.hashClientActionToken).toHaveBeenCalledWith('token_1')
  })

  it('returns 409 when the action token is revoked', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValue({
      id: 'cat_1',
      bookingId: 'booking_1',
      revokedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const res = await POST(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 409, code: 'REVOKED' })
    expect(mocks.issueClaimLinkForBooking).not.toHaveBeenCalled()
  })

  it('mints a claim link and returns the claimUrl', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValue({
      id: 'cat_1',
      bookingId: 'booking_1',
      revokedAt: null,
    })
    mocks.issueClaimLinkForBooking.mockResolvedValue({
      kind: 'ok',
      rawToken: 'raw token/+',
      invite: { id: 'invite_1' },
    })

    const res = await POST(new Request('http://localhost'), makeCtx())

    expect(mocks.issueClaimLinkForBooking).toHaveBeenCalledWith({
      bookingId: 'booking_1',
    })
    expect(res).toMatchObject({
      ok: true,
      claimUrl: `/claim/${encodeURIComponent('raw token/+')}`,
    })
  })

  it('reports alreadyClaimed without a claim link', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValue({
      id: 'cat_1',
      bookingId: 'booking_1',
      revokedAt: null,
    })
    mocks.issueClaimLinkForBooking.mockResolvedValue({ kind: 'already_claimed' })

    const res = await POST(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({
      ok: true,
      claimUrl: null,
      alreadyClaimed: true,
    })
  })

  it('returns 409 when the invite was revoked by the pro', async () => {
    mocks.prismaClientActionTokenFindUnique.mockResolvedValue({
      id: 'cat_1',
      bookingId: 'booking_1',
      revokedAt: null,
    })
    mocks.issueClaimLinkForBooking.mockResolvedValue({ kind: 'revoked' })

    const res = await POST(new Request('http://localhost'), makeCtx())

    expect(res).toMatchObject({ ok: false, status: 409 })
  })
})
