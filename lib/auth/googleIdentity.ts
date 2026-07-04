// lib/auth/googleIdentity.ts
//
// Verifies a Google Sign-In identity token (the OIDC id-token the Google
// Identity Services browser flow returns as `credential`). Mirrors
// appleIdentity.ts: verify the signature + issuer against Google's published
// certs, pin the audience (our OAuth web client id), and require a verified
// email. Reuses the already-present `google-auth-library` (no new dependency);
// `OAuth2Client.verifyIdToken` fetches + caches Google's certs internally.

import { OAuth2Client } from 'google-auth-library'

import { isNonEmptyString } from '@/lib/guards'
import { readOptionalEnv } from '@/lib/env'

// Google mints id-tokens with one of these two issuer strings.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

export type GoogleIdentity = {
  sub: string
  email: string
  emailVerified: boolean
  firstName: string | null
  lastName: string | null
}

/**
 * The OAuth web client id both the browser flow and this verifier must share.
 * Reads `GOOGLE_CLIENT_ID`, falling back to the public `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
 * (the same value — an OAuth client id is not a secret) so a single env var can
 * configure both sides. Returns null when Google Sign-In is not configured.
 */
export function googleClientId(): string | null {
  return (
    readOptionalEnv('GOOGLE_CLIENT_ID') ??
    readOptionalEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID')
  )
}

let cachedClient: OAuth2Client | null = null
function verifierClient(): OAuth2Client {
  if (!cachedClient) cachedClient = new OAuth2Client()
  return cachedClient
}

/**
 * Verify a Google identity token. Returns the stable `sub`, email, verified
 * flag, and (best-effort) given/family name on success, or `null` on any
 * failure (bad signature, wrong issuer/audience, expired, unverified email,
 * or Google Sign-In not configured). Never throws to the caller.
 */
export async function verifyGoogleIdentityToken(
  idToken: string,
): Promise<GoogleIdentity | null> {
  const audience = googleClientId()
  if (!audience) return null

  try {
    const ticket = await verifierClient().verifyIdToken({ idToken, audience })
    const payload = ticket.getPayload()
    if (!payload) return null

    if (!GOOGLE_ISSUERS.includes(payload.iss)) return null

    const sub = payload.sub
    const email = payload.email // pii-plaintext-read-ok: email from the verified Google id-token, not a DB read
    const emailVerified = payload.email_verified === true

    if (!isNonEmptyString(sub)) return null
    if (!isNonEmptyString(email)) return null
    if (!emailVerified) return null

    const firstName = isNonEmptyString(payload.given_name)
      ? payload.given_name // pii-plaintext-read-ok: name from the verified Google id-token, not a DB read
      : null
    const lastName = isNonEmptyString(payload.family_name)
      ? payload.family_name // pii-plaintext-read-ok: name from the verified Google id-token, not a DB read
      : null

    return { sub, email, emailVerified, firstName, lastName }
  } catch {
    return null
  }
}
