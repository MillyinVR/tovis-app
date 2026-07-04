import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockVerifyIdToken = vi.fn()

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken
  },
}))

import { verifyGoogleIdentityToken } from './googleIdentity'

const CLIENT_ID = '123.apps.googleusercontent.com'
const ISSUER = 'https://accounts.google.com'

function ticket(payload: Record<string, unknown> | null) {
  return { getPayload: () => payload }
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID
  delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  mockVerifyIdToken.mockReset()
})

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID
})

describe('verifyGoogleIdentityToken', () => {
  it('returns null when Google Sign-In is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID
    expect(await verifyGoogleIdentityToken('tok')).toBeNull()
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('accepts a valid token and returns sub/email/name', async () => {
    mockVerifyIdToken.mockResolvedValue(
      ticket({
        iss: ISSUER,
        sub: 'google-sub-1',
        email: 'a@b.com',
        email_verified: true,
        given_name: 'Ada',
        family_name: 'Lovelace',
      }),
    )
    expect(await verifyGoogleIdentityToken('tok')).toEqual({
      sub: 'google-sub-1',
      email: 'a@b.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'tok',
      audience: CLIENT_ID,
    })
  })

  it('accepts the bare "accounts.google.com" issuer', async () => {
    mockVerifyIdToken.mockResolvedValue(
      ticket({
        iss: 'accounts.google.com',
        sub: 's',
        email: 'a@b.com',
        email_verified: true,
      }),
    )
    const result = await verifyGoogleIdentityToken('tok')
    expect(result).not.toBeNull()
    expect(result?.firstName).toBeNull()
  })

  it('rejects an unverified email', async () => {
    mockVerifyIdToken.mockResolvedValue(
      ticket({ iss: ISSUER, sub: 's', email: 'a@b.com', email_verified: false }),
    )
    expect(await verifyGoogleIdentityToken('tok')).toBeNull()
  })

  it('rejects a wrong issuer', async () => {
    mockVerifyIdToken.mockResolvedValue(
      ticket({
        iss: 'https://evil.example',
        sub: 's',
        email: 'a@b.com',
        email_verified: true,
      }),
    )
    expect(await verifyGoogleIdentityToken('tok')).toBeNull()
  })

  it('rejects a missing email', async () => {
    mockVerifyIdToken.mockResolvedValue(
      ticket({ iss: ISSUER, sub: 's', email_verified: true }),
    )
    expect(await verifyGoogleIdentityToken('tok')).toBeNull()
  })

  it('returns null when verification throws (bad signature/expired)', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'))
    expect(await verifyGoogleIdentityToken('tok')).toBeNull()
  })

  it('returns null when the ticket has no payload', async () => {
    mockVerifyIdToken.mockResolvedValue(ticket(null))
    expect(await verifyGoogleIdentityToken('tok')).toBeNull()
  })
})
