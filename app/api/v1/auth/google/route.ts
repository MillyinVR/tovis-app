// app/api/v1/auth/google/route.ts
//
// "Sign in with Google" for the web app (and reusable by native). The client
// sends Google's identity token (the `credential` from Google Identity Services)
// + a stable deviceId. We verify the token against Google, find-or-create the
// user, and return the SAME session payload as email/password login (token in
// the body, cookie set for web). Mirrors app/api/v1/auth/apple/route.ts.

import {
  jsonOk,
  jsonFail,
  pickString,
  rateLimitIdentity,
  enforceRateLimit,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import { getCurrentTosVersion } from '@/lib/legal'
import { createActiveToken, createVerificationToken } from '@/lib/auth'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { captureAuthException } from '@/lib/observability/authEvents'
import { verifyGoogleIdentityToken } from '@/lib/auth/googleIdentity'
import { findOrCreateGoogleUser } from '@/lib/auth/findOrCreateGoogleUser'
import type { AuthLoginResponseDTO } from '@/lib/dto/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const identity = await rateLimitIdentity()
    const limited = await enforceRateLimit({ bucket: 'auth:google', identity })
    if (limited) return limited

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const identityToken = pickString(body.identityToken)
    const deviceId = pickString(body.deviceId)

    if (!identityToken) {
      return jsonFail(400, 'Missing identity token', { code: 'MISSING_TOKEN' })
    }

    const google = await verifyGoogleIdentityToken(identityToken)
    if (!google) {
      return jsonFail(401, 'Could not verify Google sign-in.', {
        code: 'INVALID_GOOGLE_TOKEN',
      })
    }

    let tosVersion: string
    try {
      tosVersion = getCurrentTosVersion()
    } catch {
      return jsonFail(500, 'Terms of Service version is not configured.', {
        code: 'TOS_VERSION_MISSING',
      })
    }

    const tenantContext = await resolveTenantContextForRequest(request)
    const email = normalizeEmail(google.email) // pii-plaintext-read-ok: email from the verified Google token, not a DB read
    if (!email) {
      return jsonFail(400, 'Google did not provide an email address.', {
        code: 'MISSING_EMAIL',
      })
    }

    const result = await findOrCreateGoogleUser({
      googleUserId: google.sub,
      email,
      firstName: google.firstName,
      lastName: google.lastName,
      tenantId: tenantContext.tenantId,
      tosVersion,
    })

    if (!result.ok) {
      return jsonFail(
        409,
        'An account already exists for this email. Please sign in with your email and password.',
        { code: result.code },
      )
    }

    const user = result.user
    const isFullyVerified = Boolean(user.phoneVerifiedAt && user.emailVerifiedAt)
    const token = isFullyVerified
      ? createActiveToken({
          userId: user.id,
          role: user.role,
          authVersion: user.authVersion,
          deviceId,
        })
      : createVerificationToken({
          userId: user.id,
          role: user.role,
          authVersion: user.authVersion,
          deviceId,
        })

    const response = jsonOk(
      {
        user: {
          id: user.id,
          email: user.email, // pii-plaintext-read-ok: auth-response identity, parity with login
          role: user.role,
        },
        token,
        nextUrl: null,
        isPhoneVerified: Boolean(user.phoneVerifiedAt),
        isEmailVerified: Boolean(user.emailVerifiedAt),
        isFullyVerified,
      } satisfies AuthLoginResponseDTO,
      200,
    )

    setSessionCookie({ response, request, token })
    return response
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.google.failed',
      route: 'auth.google',
      code: 'INTERNAL',
      userId: null,
      email: null,
      error,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
