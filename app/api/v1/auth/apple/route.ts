// app/api/v1/auth/apple/route.ts
//
// "Sign in with Apple" for the native app. The client sends Apple's identity
// token (+ optional name on first auth + a stable deviceId). We verify the
// token against Apple, find-or-create the user, and return the SAME session
// payload as email/password login (token in the body, cookie set for web).

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
import { verifyAppleIdentityToken } from '@/lib/auth/appleIdentity'
import { findOrCreateAppleUser } from '@/lib/auth/findOrCreateAppleUser'
import type { AuthLoginResponseDTO } from '@/lib/dto/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const identity = await rateLimitIdentity()
    const limited = await enforceRateLimit({ bucket: 'auth:apple', identity })
    if (limited) return limited

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const identityToken = pickString(body.identityToken)
    const deviceId = pickString(body.deviceId)
    const firstName = pickString(body.firstName) // pii-plaintext-read-ok: client-supplied name, not a DB read
    const lastName = pickString(body.lastName) // pii-plaintext-read-ok: client-supplied name, not a DB read

    if (!identityToken) {
      return jsonFail(400, 'Missing identity token', { code: 'MISSING_TOKEN' })
    }

    const apple = await verifyAppleIdentityToken(identityToken)
    if (!apple) {
      return jsonFail(401, 'Could not verify Apple sign-in.', {
        code: 'INVALID_APPLE_TOKEN',
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
    const email = normalizeEmail(apple.email) // pii-plaintext-read-ok: email from the verified Apple token, not a DB read
    if (!email) {
      return jsonFail(400, 'Apple did not provide an email address.', {
        code: 'MISSING_EMAIL',
      })
    }

    const result = await findOrCreateAppleUser({
      appleUserId: apple.sub,
      email,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
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
      event: 'auth.apple.failed',
      route: 'auth.apple',
      code: 'INTERNAL',
      userId: null,
      email: null,
      error,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
