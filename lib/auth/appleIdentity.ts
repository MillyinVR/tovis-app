// lib/auth/appleIdentity.ts
//
// Verifies an Apple "Sign in with Apple" identity token (the JWT the native app
// receives from ASAuthorization). We verify the RS256 signature against Apple's
// published JWKS, pin the issuer + audience (our app bundle id), and require a
// verified email. No new dependency: Node's crypto turns the JWK into a public
// key and the existing `jsonwebtoken` verifies the token.

import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

import { isNonEmptyString, isRecord } from '@/lib/guards'
import { readOptionalEnv, requireEnv } from '@/lib/env'

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
const JWKS_TTL_MS = 60 * 60 * 1000 // refresh Apple's keys at most hourly

type AppleJwk = {
  kid: string
  n: string
  e: string
  kty: string
}

type JwksCache = { keys: AppleJwk[]; fetchedAt: number }
let jwksCache: JwksCache | null = null

export type AppleIdentity = {
  sub: string
  email: string
  emailVerified: boolean
}

function isAppleJwk(value: unknown): value is AppleJwk {
  return (
    isRecord(value) &&
    isNonEmptyString(value.kid) &&
    isNonEmptyString(value.n) &&
    isNonEmptyString(value.e) &&
    isNonEmptyString(value.kty)
  )
}

async function fetchAppleJwks(forceRefresh = false): Promise<AppleJwk[]> {
  const now = Date.now()
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys
  }

  const res = await fetch(APPLE_JWKS_URL)
  if (!res.ok) {
    throw new Error(`Apple JWKS fetch failed: ${res.status}`)
  }

  const body: unknown = await res.json()
  const rawKeys = isRecord(body) && Array.isArray(body.keys) ? body.keys : []
  const keys = rawKeys.filter(isAppleJwk)
  jwksCache = { keys, fetchedAt: now }
  return keys
}

function jwkToPublicKeyPem(jwk: AppleJwk): string {
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  return keyObject.export({ type: 'spki', format: 'pem' }).toString()
}

/**
 * Verify an Apple identity token. Returns the stable `sub`, email, and verified
 * flag on success, or `null` on any failure (bad signature, wrong issuer/
 * audience, expired, unverified email). Never throws to the caller.
 */
export async function verifyAppleIdentityToken(
  idToken: string,
): Promise<AppleIdentity | null> {
  try {
    const decoded = jwt.decode(idToken, { complete: true })
    if (!isRecord(decoded) || !isRecord(decoded.header)) return null

    const kid = decoded.header.kid
    if (!isNonEmptyString(kid)) return null

    let keys = await fetchAppleJwks()
    let jwk = keys.find((k) => k.kid === kid)
    if (!jwk) {
      // Apple rotated its signing key — refresh once and retry.
      keys = await fetchAppleJwks(true)
      jwk = keys.find((k) => k.kid === kid)
      if (!jwk) return null
    }

    // Native tokens carry the app bundle id (`APPLE_CLIENT_ID`); the web
    // "Sign in with Apple JS" flow carries the Services ID (`APPLE_WEB_CLIENT_ID`).
    // Accept either so one endpoint serves both surfaces. `jsonwebtoken`
    // accepts a token whose `aud` matches any entry in this (non-empty) list.
    const webClientId = readOptionalEnv('APPLE_WEB_CLIENT_ID')
    const audience: [string, ...string[]] = webClientId
      ? [requireEnv('APPLE_CLIENT_ID'), webClientId]
      : [requireEnv('APPLE_CLIENT_ID')]
    const payload = jwt.verify(idToken, jwkToPublicKeyPem(jwk), {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience,
    })

    if (!isRecord(payload)) return null

    const sub = payload.sub
    const email = payload.email // pii-plaintext-read-ok: email from the verified Apple JWT, not a DB read
    const emailVerified =
      payload.email_verified === true || payload.email_verified === 'true'

    if (!isNonEmptyString(sub)) return null
    if (!isNonEmptyString(email)) return null
    if (!emailVerified) return null

    return { sub, email, emailVerified }
  } catch {
    return null
  }
}
