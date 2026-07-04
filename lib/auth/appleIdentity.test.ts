import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { verifyAppleIdentityToken } from './appleIdentity'

const AUDIENCE = 'me.tovis.Tovis'
const ISSUER = 'https://appleid.apple.com'
const KID = 'test-kid-1'

// Real RSA keypair: `signing` is published in the stubbed JWKS; `attacker` is
// not, so a token signed with it must fail signature verification.
const signing = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const attacker = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

function jwkFor(publicKeyPem: string) {
  const jwk = crypto.createPublicKey(publicKeyPem).export({ format: 'jwk' })
  return { ...jwk, kid: KID, alg: 'RS256', use: 'sig' }
}

function sign(
  privateKeyPem: string,
  payload: Record<string, unknown>,
  opts: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, privateKeyPem, {
    algorithm: 'RS256',
    keyid: KID,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: '5m',
    ...opts,
  })
}

beforeAll(() => {
  process.env.APPLE_CLIENT_ID = AUDIENCE
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ keys: [jwkFor(signing.publicKey)] }),
    })),
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('verifyAppleIdentityToken', () => {
  it('accepts a valid token and returns sub/email', async () => {
    const token = sign(signing.privateKey, {
      sub: 'apple-sub-123',
      email: 'a@b.com',
      email_verified: true,
    })
    const result = await verifyAppleIdentityToken(token)
    expect(result).toEqual({
      sub: 'apple-sub-123',
      email: 'a@b.com',
      emailVerified: true,
    })
  })

  it('accepts email_verified as the string "true"', async () => {
    const token = sign(signing.privateKey, {
      sub: 's',
      email: 'a@b.com',
      email_verified: 'true',
    })
    expect(await verifyAppleIdentityToken(token)).not.toBeNull()
  })

  it('rejects an unverified email', async () => {
    const token = sign(signing.privateKey, {
      sub: 's',
      email: 'a@b.com',
      email_verified: false,
    })
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })

  it('rejects a wrong audience (token minted for another app)', async () => {
    const token = sign(
      signing.privateKey,
      { sub: 's', email: 'a@b.com', email_verified: true },
      { audience: 'com.someone.else' },
    )
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })

  it('accepts a web Services-ID audience when APPLE_WEB_CLIENT_ID is set', async () => {
    process.env.APPLE_WEB_CLIENT_ID = 'me.tovis.web'
    try {
      const token = sign(
        signing.privateKey,
        { sub: 's', email: 'a@b.com', email_verified: true },
        { audience: 'me.tovis.web' },
      )
      expect(await verifyAppleIdentityToken(token)).not.toBeNull()
    } finally {
      delete process.env.APPLE_WEB_CLIENT_ID
    }
  })

  it('rejects the web Services-ID audience when APPLE_WEB_CLIENT_ID is unset', async () => {
    delete process.env.APPLE_WEB_CLIENT_ID
    const token = sign(
      signing.privateKey,
      { sub: 's', email: 'a@b.com', email_verified: true },
      { audience: 'me.tovis.web' },
    )
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })

  it('rejects a wrong issuer', async () => {
    const token = sign(
      signing.privateKey,
      { sub: 's', email: 'a@b.com', email_verified: true },
      { issuer: 'https://evil.example' },
    )
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })

  it('rejects a bad signature (signed by a key not in the JWKS)', async () => {
    const token = sign(attacker.privateKey, {
      sub: 's',
      email: 'a@b.com',
      email_verified: true,
    })
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = sign(
      signing.privateKey,
      { sub: 's', email: 'a@b.com', email_verified: true },
      { expiresIn: '-1h' },
    )
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })

  it('rejects a missing email', async () => {
    const token = sign(signing.privateKey, { sub: 's', email_verified: true })
    expect(await verifyAppleIdentityToken(token)).toBeNull()
  })
})
