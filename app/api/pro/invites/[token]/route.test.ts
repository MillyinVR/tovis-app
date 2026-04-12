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
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/clients/clientClaimLinks', () => ({
  getClientClaimLinkPublicState: mocks.getClientClaimLinkPublicState,
}))

import { GET } from './route'

function makeLink(overrides?: {
  id?: string
  token?: string
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
    token: overrides?.token ?? 'token_1',
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

describe('GET /api/pro/invites/[token]', () => {
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
  })

  it('returns NOT_FOUND when token is missing', async () => {
    const result = await GET(new Request('http://localhost/api/pro/invites/'), {
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
      new Request('http://localhost/api/pro/invites/token_1'),
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
      new Request('http://localhost/api/pro/invites/token_1'),
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
      new Request('http://localhost/api/pro/invites/token_1'),
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
      new Request('http://localhost/api/pro/invites/token_1'),
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
        new Request('http://localhost/api/pro/invites/token_1'),
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
        'GET /api/pro/invites/[token] error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})