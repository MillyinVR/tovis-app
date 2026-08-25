// lib/auth/social/handleSocialSignIn.ts
//
// The body of POST /api/v1/auth/google and POST /api/v1/auth/apple, which were
// line-for-line the same route apart from the provider's name, its rate-limit
// bucket, its token verifier, and where the person's name comes from.
//
// Keeping one copy is not tidiness here. The two routes previously called two
// byte-identical find-or-create helpers, and the unhandled-P2002 bug those
// carried therefore existed twice and had to be found twice. The provider's
// differences are the config object below; everything else happens once.
//
// What this does NOT do any more is create an account. A provider proves an
// identity, which is not the same as a signup: it supplies no phone number, no
// SMS consent, no role and no location, and it cannot know that a pro already
// holds an UNCLAIMED profile for that email. When there is no account yet this
// hands back a single-use signup ticket and stops. See
// lib/auth/socialSignupTicket.ts.

import {
  enforceRateLimit,
  jsonFail,
  jsonOk,
  pickString,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { createActiveToken, createVerificationToken } from '@/lib/auth'
import { resolveSocialAccount } from '@/lib/auth/resolveSocialAccount'
import { createSocialSignupTicket } from '@/lib/auth/socialSignupTicket'
import type { AuthSocialSignInResponseDTO } from '@/lib/dto/auth'
import { isRecord } from '@/lib/guards'
import { captureAuthException } from '@/lib/observability/authEvents'
import type { RateLimitBucket } from '@/lib/rateLimit/policies'
import { getAuditClientIp } from '@/lib/security/auditClientIp'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import type { SocialAuthProvider } from '@prisma/client'

/** What a provider's identity-token verifier gives back once it is satisfied. */
export type VerifiedSocialIdentity = {
  sub: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export type SocialSignInConfig = {
  provider: SocialAuthProvider
  /** Sentence-case, for user-facing copy: "Could not verify Google sign-in." */
  displayName: string
  bucket: RateLimitBucket
  /** Log label, e.g. 'auth.google'. */
  routeLabel: string
  /** Failure code for an identity token the provider will not vouch for. */
  invalidTokenCode: string
  /**
   * Where the person's NAME comes from, which genuinely differs by provider:
   *
   *  - `'TOKEN'` (Google): `given_name`/`family_name` are claims in the
   *    verified id-token, so they are trustworthy and the body is ignored.
   *  - `'BODY'` (Apple): the identity token carries no name at all. Apple
   *    releases it exactly ONCE, in the authorization response on first
   *    consent, so the client has to forward it and a later sign-in gets
   *    nothing. It is therefore client-supplied and unverified — which is
   *    tolerable for a display name and for nothing else.
   */
  namesFrom: 'TOKEN' | 'BODY'
  verifyIdentityToken(
    identityToken: string,
  ): Promise<VerifiedSocialIdentity | null>
}

export async function handleSocialSignIn(
  request: Request,
  config: SocialSignInConfig,
): Promise<Response> {
  try {
    const identity = await rateLimitIdentity()
    const limited = await enforceRateLimit({ bucket: config.bucket, identity })
    if (limited) return limited

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const identityToken = pickString(body.identityToken)
    const deviceId = pickString(body.deviceId)

    if (!identityToken) {
      return jsonFail(400, 'Missing identity token', { code: 'MISSING_TOKEN' })
    }

    const verified = await config.verifyIdentityToken(identityToken)
    if (!verified) {
      return jsonFail(401, `Could not verify ${config.displayName} sign-in.`, {
        code: config.invalidTokenCode,
      })
    }

    const email = normalizeEmail(verified.email) // pii-plaintext-read-ok: email from the verified provider token, not a DB read
    if (!email) {
      return jsonFail(
        400,
        `${config.displayName} did not provide an email address.`,
        { code: 'MISSING_EMAIL' },
      )
    }

    const names =
      config.namesFrom === 'TOKEN'
        ? {
            firstName: verified.firstName ?? null,
            lastName: verified.lastName ?? null,
          }
        : {
            firstName: pickString(body.firstName) || null, // pii-plaintext-read-ok: client-supplied name, not a DB read
            lastName: pickString(body.lastName) || null, // pii-plaintext-read-ok: client-supplied name, not a DB read
          }

    const resolved = await resolveSocialAccount({
      provider: config.provider,
      subject: verified.sub,
      email,
    })

    if (resolved.outcome === 'ACCOUNT_EXISTS_UNVERIFIED') {
      return jsonFail(
        409,
        'An account already exists for this email. Please sign in with your email and password.',
        { code: 'ACCOUNT_EXISTS_UNVERIFIED' },
      )
    }

    // Signup tenant = the tenant whose domain served the request. Resolved only
    // on the paths that need it: an existing user already has a home tenant and
    // this must not restamp it.
    if (resolved.outcome === 'NEEDS_SIGNUP') {
      const tenantContext = await resolveTenantContextForRequest(request)

      const ticket = await createSocialSignupTicket({
        provider: config.provider,
        subject: verified.sub,
        email,
        firstName: names.firstName,
        lastName: names.lastName,
        tenantId: tenantContext.tenantId,
        ip: getAuditClientIp(request),
        userAgent: request.headers.get('user-agent'),
      })

      // 200, not 201: nothing was created. The provider verified an identity
      // and the person now has to finish signing up.
      return jsonOk(
        {
          status: 'SIGNUP_REQUIRED',
          signupTicket: ticket.token,
          ticketExpiresAt: ticket.expiresAt.toISOString(),
          prefill: {
            email, // pii-plaintext-read-ok: echoing back the email the caller's own provider token supplied
            firstName: names.firstName,
            lastName: names.lastName,
          },
        } satisfies AuthSocialSignInResponseDTO,
        200,
      )
    }

    const user = resolved.user
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
        status: 'SIGNED_IN',
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
      } satisfies AuthSocialSignInResponseDTO,
      200,
    )

    setSessionCookie({ response, request, token })
    return response
  } catch (error: unknown) {
    captureAuthException({
      event: `${config.routeLabel}.failed`,
      route: config.routeLabel,
      code: 'INTERNAL',
      userId: null,
      email: null,
      error,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
