import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  getClientClaimLinkPublicState: vi.fn(),
  enforceRateLimit: vi.fn(),
  rateLimitIdentity: vi.fn(),
  tokenRateLimitIdentity: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/app/api/_utils/rateLimit', () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  rateLimitIdentity: mocks.rateLimitIdentity,
  tokenRateLimitIdentity: mocks.tokenRateLimitIdentity,
}))

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  getClientClaimLinkPublicState: mocks.getClientClaimLinkPublicState,
}))

import { GET } from './route'

function makeLink(overrides?: {
  id?: string
  token?: string | null
  tokenHash?: string | null
  professionalId?: string
  clientId?: string
  bookingId?: string
  invitedName?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  acceptedByUserId?: string | null
  revokedAt?: Date | null
  revokedByUserId?: string | null
  revokeReason?: string | null
  createdAt?: Date
  updatedAt?: Date
  client?: {
    id?: string
    userId?: string | null
    claimStatus?: ClientClaimStatus
    claimedAt?: Date | null
    preferredContactMethod?: ContactMethod | null
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    token: overrides?.token !== undefined ? overrides.token : null,
    tokenHash:
      overrides?.tokenHash !== undefined
        ? overrides.tokenHash
        : 'hashed_token_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
    clientId: overrides?.clientId ?? 'client_1',
    bookingId: overrides?.bookingId ?? 'booking_1',
    invitedName: overrides?.invitedName ?? 'Tori Morales',
    invitedEmail:
      overrides?.invitedEmail !== undefined
        ? overrides.invitedEmail
        : 'tori@example.com',
    invitedPhone:
      overrides?.invitedPhone !== undefined
        ? overrides.invitedPhone
        : null,
    preferredContactMethod:
      overrides?.preferredContactMethod !== undefined
        ? overrides.preferredContactMethod
        : ContactMethod.EMAIL,
    status: overrides?.status ?? ProClientInviteStatus.PENDING,
    acceptedAt:
      overrides?.acceptedAt !== undefined ? overrides.acceptedAt : null,
    acceptedByUserId:
      overrides?.acceptedByUserId !== undefined
        ? overrides.acceptedByUserId
        : null,
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    revokedByUserId:
      overrides?.revokedByUserId !== undefined
        ? overrides.revokedByUserId
        : null,
    revokeReason:
      overrides?.revokeReason !== undefined ? overrides.revokeReason : null,
    createdAt:
      overrides?.createdAt ?? new Date('2026-04-12T10:00:00.000Z'),
    updatedAt:
      overrides?.updatedAt ?? new Date('2026-04-12T10:00:00.000Z'),
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            userId: null,
            claimStatus: ClientClaimStatus.UNCLAIMED,
            claimedAt: null,
            preferredContactMethod: null,
          },
  }
}

describe('GET /api/v1/pro/invites/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.jsonFail.mockImplementation(
      (status: number, error: string, extra?: unknown) => ({
        ok: false,
        status,
        error,
        ...(extra && typeof extra === 'object' ? extra : {}),
      }),
    )

    mocks.jsonOk.mockImplementation((data: unknown, status = 200) => ({
      ok: true,
      status,
      data,
    }))

    mocks.getClientClaimLinkPublicState.mockResolvedValue({
      kind: 'not_found',
    })

    // Default: neither bucket is over its ceiling.
    mocks.enforceRateLimit.mockResolvedValue(null)
    mocks.rateLimitIdentity.mockResolvedValue({ kind: 'ip', id: '203.0.113.7' })
    mocks.tokenRateLimitIdentity.mockImplementation((prefix: string) => ({
      kind: 'token',
      id: prefix,
    }))
  })

  it('returns NOT_FOUND when token is missing', async () => {
    const result = await GET(new Request('http://localhost/api/v1/pro/invites/'), {
      params: { token: '   ' },
    })

    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Invite not found.', {
      code: 'NOT_FOUND',
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Invite not found.',
      code: 'NOT_FOUND',
    })
  })

  it('returns NOT_FOUND when invite does not exist', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'not_found',
    })

    const result = await GET(
      new Request('http://localhost/api/v1/pro/invites/token_1'),
      {
        params: { token: 'token_1' },
      },
    )

    expect(mocks.getClientClaimLinkPublicState).toHaveBeenCalledWith({
      token: 'token_1',
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(404, 'Invite not found.', {
      code: 'NOT_FOUND',
    })

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Invite not found.',
      code: 'NOT_FOUND',
    })
  })

  it('returns REVOKED when claim link state is revoked', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'revoked',
      link: makeLink({
        status: ProClientInviteStatus.REVOKED,
      }),
    })

    const result = await GET(
      new Request('http://localhost/api/v1/pro/invites/token_1'),
      {
        params: { token: 'token_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      410,
      'Invite is no longer available.',
      {
        code: 'REVOKED',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 410,
      error: 'Invite is no longer available.',
      code: 'REVOKED',
    })
  })

  it('returns ALREADY_CLAIMED when claim link state is already_claimed', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'already_claimed',
      link: makeLink({
        status: ProClientInviteStatus.ACCEPTED,
        client: {
          id: 'client_1',
          userId: 'user_1',
          claimStatus: ClientClaimStatus.CLAIMED,
          claimedAt: new Date('2026-04-12T12:00:00.000Z'),
          preferredContactMethod: null,
        },
      }),
    })

    const result = await GET(
      new Request('http://localhost/api/v1/pro/invites/token_1'),
      {
        params: { token: 'token_1' },
      },
    )

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Invite already claimed.',
      {
        code: 'ALREADY_CLAIMED',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Invite already claimed.',
      code: 'ALREADY_CLAIMED',
    })
  })

  it('returns invite payload when claim link state is ready', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValueOnce({
      kind: 'ready',
      link: makeLink({
        id: 'invite_1',
        professionalId: 'pro_123',
        clientId: 'client_123',
        bookingId: 'booking_123',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
        status: ProClientInviteStatus.PENDING,
        revokedAt: null,
        client: {
          id: 'client_123',
          userId: null,
          claimStatus: ClientClaimStatus.UNCLAIMED,
          claimedAt: null,
          preferredContactMethod: null,
        },
      }),
    })

    const result = await GET(
      new Request('http://localhost/api/v1/pro/invites/token_1'),
      {
        params: Promise.resolve({ token: 'token_1' }),
      },
    )

    expect(mocks.jsonOk).toHaveBeenCalledWith(
      {
        inviteId: 'invite_1',
        professionalId: 'pro_123',
        bookingId: 'booking_123',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
      },
      200,
    )

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        inviteId: 'invite_1',
        professionalId: 'pro_123',
        bookingId: 'booking_123',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
      },
    })
  })

  it('returns INTERNAL_ERROR when the lookup throws', async () => {
    mocks.getClientClaimLinkPublicState.mockRejectedValueOnce(
      new Error('lookup blew up'),
    )

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await GET(
        new Request('http://localhost/api/v1/pro/invites/token_1'),
        {
          params: { token: 'token_1' },
        },
      )

      expect(mocks.jsonFail).toHaveBeenCalledWith(
        500,
        'Internal server error',
      )

      expect(result).toEqual({
        ok: false,
        status: 500,
        error: 'Internal server error',
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'GET /api/v1/pro/invites/[token] error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('caps by IP and by token-hash prefix on the shared claim buckets', async () => {
    mocks.getClientClaimLinkPublicState.mockResolvedValue({ kind: 'not_found' })

    await GET(new Request('http://localhost/api/v1/pro/invites/tok_1'), {
      params: { token: 'tok_1' },
    })

    // Same buckets as /api/v1/public/claim/[token] — a caller must not be able
    // to double its budget by alternating between the two routes.
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(2)
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(1, {
      bucket: 'account-invite:mint',
      identity: { kind: 'ip', id: '203.0.113.7' },
    })
    expect(mocks.enforceRateLimit).toHaveBeenNthCalledWith(2, {
      bucket: 'account-invite:mint:token',
      identity: { kind: 'token', id: expect.any(String) },
    })

    // The token bucket must be keyed on the HASH, never the raw token.
    const [prefix] = mocks.tokenRateLimitIdentity.mock.calls[0] ?? []
    expect(prefix).toHaveLength(16)
    expect(prefix).not.toContain('tok_1')
  })

  it('refuses on the IP bucket BEFORE any claim-link lookup', async () => {
    const blocked = { ok: false, status: 429, error: 'Too many requests.' }
    mocks.enforceRateLimit.mockResolvedValueOnce(blocked)

    const result = await GET(
      new Request('http://localhost/api/v1/pro/invites/tok_1'),
      { params: { token: 'tok_1' } },
    )

    expect(result).toBe(blocked)
    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
    // Short-circuits: the token bucket is never consulted.
    expect(mocks.enforceRateLimit).toHaveBeenCalledTimes(1)
  })

  it('refuses on the token bucket BEFORE any claim-link lookup', async () => {
    const blocked = { ok: false, status: 429, error: 'Too many requests.' }
    mocks.enforceRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(blocked)

    const result = await GET(
      new Request('http://localhost/api/v1/pro/invites/tok_1'),
      { params: { token: 'tok_1' } },
    )

    expect(result).toBe(blocked)
    expect(mocks.getClientClaimLinkPublicState).not.toHaveBeenCalled()
  })
})