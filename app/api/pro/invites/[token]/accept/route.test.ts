import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ContactMethod,
  ProClientInviteStatus,
} from '@prisma/client'

const mocks = vi.hoisted(() => {
  const tx = {
    proClientInvite: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    clientProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    requireClient: vi.fn(),
    jsonFail: vi.fn(),
    jsonOk: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
    },
    tx,
  }
})

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

import { POST } from './route'

function makeRequest(): Request {
  return new Request('http://localhost/api/pro/invites/token_1/accept', {
    method: 'POST',
  })
}

describe('POST /api/pro/invites/[token]/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(new Date('2026-04-12T12:00:00.000Z'))

    mocks.requireClient.mockResolvedValue({
      ok: true,
      clientId: 'client_1',
      user: {
        id: 'user_1',
      },
    })

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

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
        callback(mocks.tx),
    )

    mocks.tx.proClientInvite.findUnique.mockResolvedValue(null)
    mocks.tx.proClientInvite.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.clientProfile.findUnique.mockResolvedValue({
      id: 'client_1',
      preferredContactMethod: null,
    })
    mocks.tx.clientProfile.update.mockResolvedValue({
      id: 'client_1',
      preferredContactMethod: ContactMethod.EMAIL,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns auth response when requireClient fails', async () => {
    const authRes = { ok: false, status: 401, error: 'Unauthorized' }

    mocks.requireClient.mockResolvedValueOnce({
      ok: false,
      res: authRes,
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(result).toBe(authRes)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns NOT_FOUND when token is missing', async () => {
    const result = await POST(makeRequest(), {
      params: { token: '   ' },
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

    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns NOT_FOUND when invite does not exist', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce(null)

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
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

  it('returns REVOKED when invite status is REVOKED', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.REVOKED,
      acceptedAt: null,
      revokedAt: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

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
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: new Date('2026-04-12T11:00:00.000Z'),
      preferredContactMethod: ContactMethod.EMAIL,
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

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

  it('returns ALREADY_ACCEPTED when invite status is ACCEPTED', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.ACCEPTED,
      acceptedAt: new Date('2026-04-12T11:00:00.000Z'),
      revokedAt: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

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
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.PENDING,
      acceptedAt: new Date('2026-04-12T11:00:00.000Z'),
      revokedAt: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

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

  it('returns CLIENT_NOT_FOUND when authenticated client profile is missing', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce(null)

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      404,
      'Client profile not found.',
      {
        code: 'CLIENT_NOT_FOUND',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 404,
      error: 'Client profile not found.',
      code: 'CLIENT_NOT_FOUND',
    })
  })

  it('returns CONFLICT when claim update does not succeed and invite is still pending', async () => {
    mocks.tx.proClientInvite.findUnique
      .mockResolvedValueOnce({
        id: 'invite_1',
        bookingId: 'booking_1',
        status: ProClientInviteStatus.PENDING,
        acceptedAt: null,
        revokedAt: null,
        preferredContactMethod: ContactMethod.EMAIL,
      })
      .mockResolvedValueOnce({
        status: ProClientInviteStatus.PENDING,
        acceptedAt: null,
        revokedAt: null,
        bookingId: 'booking_1',
      })

    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Invite could not be accepted.',
      {
        code: 'CONFLICT',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Invite could not be accepted.',
      code: 'CONFLICT',
    })
  })

  it('returns REVOKED when claim update loses a race to revocation', async () => {
    mocks.tx.proClientInvite.findUnique
      .mockResolvedValueOnce({
        id: 'invite_1',
        bookingId: 'booking_1',
        status: ProClientInviteStatus.PENDING,
        acceptedAt: null,
        revokedAt: null,
        preferredContactMethod: ContactMethod.EMAIL,
      })
      .mockResolvedValueOnce({
        status: ProClientInviteStatus.REVOKED,
        acceptedAt: null,
        revokedAt: new Date('2026-04-12T12:00:00.000Z'),
        bookingId: 'booking_1',
      })

    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

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

  it('accepts the invite successfully and writes preferredContactMethod when client profile does not have one', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce({
      id: 'client_1',
      preferredContactMethod: null,
    })

    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.tx.proClientInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite_1',
        status: ProClientInviteStatus.PENDING,
        acceptedAt: null,
        revokedAt: null,
      },
      data: {
        status: ProClientInviteStatus.ACCEPTED,
        acceptedAt: new Date('2026-04-12T12:00:00.000Z'),
        acceptedByUserId: 'user_1',
      },
    })

    expect(mocks.tx.clientProfile.update).toHaveBeenCalledWith({
      where: { id: 'client_1' },
      data: {
        preferredContactMethod: ContactMethod.EMAIL,
      },
    })

    expect(mocks.jsonOk).toHaveBeenCalledWith({ bookingId: 'booking_1' }, 200)

    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        bookingId: 'booking_1',
      },
    })
  })

  it('accepts the invite successfully without overwriting an existing preferredContactMethod', async () => {
    mocks.tx.proClientInvite.findUnique.mockResolvedValueOnce({
      id: 'invite_1',
      bookingId: 'booking_1',
      status: ProClientInviteStatus.PENDING,
      acceptedAt: null,
      revokedAt: null,
      preferredContactMethod: ContactMethod.EMAIL,
    })

    mocks.tx.clientProfile.findUnique.mockResolvedValueOnce({
      id: 'client_1',
      preferredContactMethod: ContactMethod.SMS,
    })

    mocks.tx.proClientInvite.updateMany.mockResolvedValueOnce({ count: 1 })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.tx.clientProfile.update).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      status: 200,
      data: {
        bookingId: 'booking_1',
      },
    })
  })

  it('returns INTERNAL_ERROR when transaction throws', async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce(new Error('db exploded'))

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const result = await POST(makeRequest(), {
        params: { token: 'token_1' },
      })

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
        'POST /api/pro/invites/[token]/accept error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})