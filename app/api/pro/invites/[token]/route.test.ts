import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactMethod, ProClientInviteStatus } from '@prisma/client'

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
  bookingId?: string
  invitedName?: string
  invitedEmail?: string | null
  invitedPhone?: string | null
  preferredContactMethod?: ContactMethod | null
  status?: ProClientInviteStatus
  acceptedAt?: Date | null
  revokedAt?: Date | null
}) {
  return {
    id: overrides?.id ?? 'invite_1',
    professionalId: overrides?.professionalId ?? 'pro_1',
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
    revokedAt: overrides?.revokedAt !== undefined ? overrides.revokedAt : null,
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
        bookingId: true,
        invitedName: true,
        invitedEmail: true,
        invitedPhone: true,
        preferredContactMethod: true,
        status: true,
        acceptedAt: true,
        revokedAt: true,
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

  it('returns ALREADY_ACCEPTED when invite status is ACCEPTED', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.ACCEPTED,
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
      'Invite already accepted.',
      {
        code: 'ALREADY_ACCEPTED',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Invite already accepted.',
      code: 'ALREADY_ACCEPTED',
    })
  })

  it('returns ALREADY_ACCEPTED when acceptedAt is already set even if status is still PENDING', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        status: ProClientInviteStatus.PENDING,
        acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
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
      'Invite already accepted.',
      {
        code: 'ALREADY_ACCEPTED',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Invite already accepted.',
      code: 'ALREADY_ACCEPTED',
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

  it('returns invite payload when invite is pending and available', async () => {
    mocks.findUnique.mockResolvedValueOnce(
      makeInvite({
        id: 'invite_1',
        professionalId: 'pro_123',
        bookingId: 'booking_123',
        invitedName: 'Tori Morales',
        invitedEmail: 'tori@example.com',
        invitedPhone: '+16195551234',
        preferredContactMethod: ContactMethod.SMS,
        status: ProClientInviteStatus.PENDING,
        acceptedAt: null,
        revokedAt: null,
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