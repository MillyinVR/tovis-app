import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClient: vi.fn(),
  jsonFail: vi.fn(),
  jsonOk: vi.fn(),
  acceptClientClaimFromLink: vi.fn(),
}))

vi.mock('@/app/api/_utils', () => ({
  requireClient: mocks.requireClient,
  jsonFail: mocks.jsonFail,
  jsonOk: mocks.jsonOk,
}))

vi.mock('@/lib/clients/clientClaim', () => ({
  acceptClientClaimFromLink: mocks.acceptClientClaimFromLink,
}))

import { POST } from './route'

function makeRequest(): Request {
  return new Request('http://localhost/api/v1/pro/invites/token_1/accept', {
    method: 'POST',
  })
}

describe('POST /api/v1/pro/invites/[token]/accept', () => {
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

    mocks.acceptClientClaimFromLink.mockResolvedValue({
      kind: 'ok',
      bookingId: 'booking_1',
    })
  })

  it('supports promise params', async () => {
    await POST(makeRequest(), {
      params: Promise.resolve({ token: 'token_1' }),
    })

    expect(mocks.acceptClientClaimFromLink).toHaveBeenCalledWith({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
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
    expect(mocks.acceptClientClaimFromLink).not.toHaveBeenCalled()
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

    expect(mocks.acceptClientClaimFromLink).not.toHaveBeenCalled()
  })

  it('passes token and acting client identity to the claim service', async () => {
    await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.acceptClientClaimFromLink).toHaveBeenCalledWith({
      token: 'token_1',
      actingUserId: 'user_1',
      actingClientId: 'client_1',
    })
  })

  it('returns NOT_FOUND when claim service returns not_found', async () => {
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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

  it('returns MERGE_REFUSED without leaking the reason when the merge declines', async () => {
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
      kind: 'merge_refused',
      reason: 'source_not_shell',
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      409,
      'This history needs a quick review before it can be added to your account. Contact support and we will finish it for you.',
      { code: 'MERGE_REFUSED' },
    )

    expect(result).toEqual({
      ok: false,
      status: 409,
      error:
        'This history needs a quick review before it can be added to your account. Contact support and we will finish it for you.',
      code: 'MERGE_REFUSED',
    })

    // The reason is a support signal, not something the viewer can act on.
    expect(JSON.stringify(result)).not.toContain('source_not_shell')
  })

  /**
   * The kill switch gets a 503 and its own code, not the 409 CLIENT_MISMATCH it
   * used to share. Both halves matter: the code is what the surfaces branch on,
   * and the 503 is what keeps "we turned it off" legible to monitoring instead of
   * hiding inside the ordinary conflict bucket.
   */
  it('returns 503 CLAIM_PAUSED when the merge kill switch is pulled', async () => {
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
      kind: 'merge_paused',
    })

    const result = await POST(makeRequest(), {
      params: { token: 'token_1' },
    })

    expect(mocks.jsonFail).toHaveBeenCalledWith(
      503,
      'Claiming is paused right now. Nothing changed on your account — please try again shortly.',
      { code: 'CLAIM_PAUSED' },
    )

    expect(result).toEqual({
      ok: false,
      status: 503,
      error:
        'Claiming is paused right now. Nothing changed on your account — please try again shortly.',
      code: 'CLAIM_PAUSED',
    })
  })

  /**
   * A client too old to know `CLAIM_PAUSED` renders this message verbatim, with
   * no card around it — so it has to read as a complete, correct sentence on its
   * own, and must never tell a blameless viewer to go fix their account. That is
   * the exact failure this whole change exists to kill, so pin it rather than
   * trusting the next person editing the copy to remember.
   */
  it('phrases the paused message so a client that does not know the code degrades honestly', async () => {
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
      kind: 'merge_paused',
    })

    await POST(makeRequest(), { params: { token: 'token_1' } })

    // A complete sentence that tells the viewer to wait…
    expect(mocks.jsonFail).toHaveBeenCalledWith(
      503,
      expect.stringMatching(/try again.*\.$/i),
      { code: 'CLAIM_PAUSED' },
    )

    // …and never the old card's advice, which is the bug this replaces: there is
    // no other account to sign into and no reason to make one.
    expect(mocks.jsonFail).not.toHaveBeenCalledWith(
      503,
      expect.stringMatching(/sign in|different client|correct client account/i),
      expect.anything(),
    )
  })

  it('returns CONFLICT when claim service returns conflict', async () => {
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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
    mocks.acceptClientClaimFromLink.mockResolvedValueOnce({
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
    mocks.acceptClientClaimFromLink.mockRejectedValueOnce(
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
        'POST /api/v1/pro/invites/[token]/accept error',
        expect.any(Error),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})