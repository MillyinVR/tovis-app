import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientClaimStatus,
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => ({
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    proClientInvite: {
      findUnique: mocks.findUnique,
    },
  },
}))

import { GET } from './route'

function makeInvite(overrides?: {
  id?: string
  professionalId?: string
  clientId?: string
  bookingId?: string
  invitedName?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  status?: ProClientInviteStatus
  revokedAt?: Date | null
  client?: {
    id?: string
    claimStatus?: ClientClaimStatus
  } | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
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
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
    client:
      overrides?.client !== undefined
        ? overrides.client
        : {
            id: 'client_1',
            claimStatus: ClientClaimStatus.UNCLAIMED,
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

    mocks.findUnique.mockResolvedValue(null)
  })

  it('returns NOT_FOUND when token is missing', async () => {
    const result = await GET(new Request('http://localhost/api/pro/invites/'), {
      params: { token: '   ' },
    })

    expect(mocks.findUnique).not.toHaveBeenCalled()
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
    mocks.findUnique.mockResolvedValueOnce(null)

    const result = await GET(
      new Request('http://localhost/api/pro/invites/token_1'),
      {
        params: { token: 'token_1' },
      },
    )

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { token: 'token_1' },
      select: {
        id: true,
        professionalId: true,
        clientId: true,
        bookingId: true,
        invitedName: true,
        invitedEmail: true,
        invitedPhone: true,
        preferredContactMethod: true,
        status: true,
        revokedAt: true,
        client: {
          select: {
            id: true,
            claimStatus: true,
          },
        },
      },
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

  it('returns NOT_FOUND when linked client identity is missing', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        client: null,
      }),
    )

    const result = await GET(
      new Request('http://localhost/api/pro/invites/token_1'),
      {
        params: { token: 'token_1' },
      },
    )

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

  it('returns REVOKED when invite status is REVOKED', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.REVOKED,
      }),
    )

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

  it('returns REVOKED when revokedAt is already set even if status is still PENDING', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.PENDING,
        revokedAt: new Date('2026-04-12T12:00:00.000Z'),
      }),
    )

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

  it('returns ALREADY_CLAIMED when linked client identity is claimed even if invite row is still pending', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.PENDING,
        client: {
          id: 'client_1',
          claimStatus: ClientClaimStatus.CLAIMED,
        },
      }),
    )

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

  it('returns ALREADY_CLAIMED when invite row is ACCEPTED and linked client identity is claimed', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.ACCEPTED,
        client: {
          id: 'client_1',
          claimStatus: ClientClaimStatus.CLAIMED,
        },
      }),
    )

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

  it('returns invite payload when invite is pending, not revoked, and linked client is unclaimed', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
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
          claimStatus: ClientClaimStatus.UNCLAIMED,
        },
      }),
    )

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
    mocks.findUnique.mockRejectedValueOnce(new Error('db blew up'))

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