// app/api/pro/invites/[token]/accept/route.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  acceptProClientClaimLink: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/claims/proClientClaim', () => ({
  acceptProClientClaimLink: mocks.acceptProClientClaimLink,
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

    mocks.acceptProClientClaimLink.mockResolvedValue({
      kind: 'ok',
      bookingId: 'booking_1',
    })
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
    expect(mocks.acceptProClientClaimLink).not.toHaveBeenCalled()
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

    expect(mocks.acceptProClientClaimLink).not.toHaveBeenCalled()
  })

  it('passes token and acting client identity to the claim service', async () => {
    await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.acceptProClientClaimLink).toHaveBeenCalledWith({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })
  })

  it('returns NOT_FOUND when claim service returns not_found', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'not_found',
    })

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

  it('returns REVOKED when claim service returns revoked', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'revoked',
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

  it('returns ALREADY_CLAIMED when claim service returns already_claimed', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'already_claimed',
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

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

  it('returns CLIENT_NOT_FOUND when claim service returns client_not_found', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'client_not_found',
    })

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

  it('returns CLIENT_MISMATCH when claim service returns client_mismatch', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'client_mismatch',
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Invite does not belong to this client.',
      {
        code: 'CLIENT_MISMATCH',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Invite does not belong to this client.',
      code: 'CLIENT_MISMATCH',
    })
  })

  it('returns CONFLICT when claim service returns conflict', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'conflict',
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'Invite could not be claimed.',
      {
        code: 'CONFLICT',
      },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Invite could not be claimed.',
      code: 'CONFLICT',
    })
  })

  it('returns bookingId when claim succeeds', async () => {
    mocks.acceptProClientClaimLink.mockResolvedValueOnce({
      kind: 'ok',
      bookingId: 'booking_1',
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
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

  it('returns INTERNAL_ERROR when claim service throws', async () => {
    mocks.acceptProClientClaimLink.mockRejectedValueOnce(
      new Error('claim service exploded'),
    )

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