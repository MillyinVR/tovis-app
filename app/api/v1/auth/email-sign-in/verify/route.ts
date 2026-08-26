// app/api/v1/auth/email-sign-in/verify/route.ts
//
// Passwordless email sign-in — step 2. Redeem either credential from the email
// (the magic-link token OR the 6-digit code) and mint the SAME session payload
// as password login.
//
// 🔴 POST ONLY, AND THAT IS LOAD-BEARING. There is deliberately no GET handler
// here and no sign-in on page load anywhere in this flow. Mail scanners,
// corporate link-rewriters and chat link-preview bots all fetch URLs found in
// email; a single-use token consumed on GET is burned by a robot before the
// human ever clicks, and the person is told their link is invalid. The link in
// the email lands on /signin/<token>, which renders a page with an explicit
// button that POSTs here — the precedent /verify-email already sets.
//
// Redeeming proves control of the mailbox, so an unverified address is marked
// verified here — the same reasoning phone-login/verify applies to a number.

import {
  jsonOk,
  jsonFail,
  pickString,
  rateLimitIdentity,
  enforceRateLimit,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import {
  consumeEmailSignInCode,
  consumeEmailSignInLinkToken,
  type ConsumeEmailSignInResult,
} from '@/lib/auth/emailSignIn'
import { markUserEmailVerified } from '@/lib/auth/contactVerification'
import { createActiveToken, createVerificationToken } from '@/lib/auth'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import type { AuthLoginResponseDTO } from '@/lib/dto/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const identity = await rateLimitIdentity()
    const limited = await enforceRateLimit({
      bucket: 'auth:email-sign-in:verify',
      identity,
    })
    if (limited) return limited

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const token = pickString(body.token)
    const email = normalizeEmail(body.email) // pii-plaintext-read-ok: client-supplied address from this request's own body, not a DB read
    const code = pickString(body.code)?.trim() ?? ''
    const deviceId = pickString(body.deviceId)

    /**
     * ONE rejection for every failure mode — malformed, unknown, wrong secret,
     * wrong code, expired, already used, wrong purpose, attempts exhausted.
     * The caller must not be able to tell "this code was wrong" from "this
     * address has no account", or the code path becomes the enumeration oracle
     * that the request route is so careful not to be.
     */
    const rejected = () =>
      jsonFail(400, 'This sign-in link or code is invalid or has expired.', {
        code: 'SIGN_IN_REJECTED',
      })

    let result: ConsumeEmailSignInResult

    if (token) {
      result = await consumeEmailSignInLinkToken({ rawToken: token })
    } else if (email && code) {
      result = await consumeEmailSignInCode({ email, code })
    } else {
      return jsonFail(400, 'A sign-in link or code is required.', {
        code: 'MISSING_FIELDS',
      })
    }

    if (!result.ok) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.email_sign_in.verify.rejected',
        route: 'auth.emailSignIn.verify',
        userId: null,
        email: email || null,
        verificationId: result.tokenId,
        code: 'SIGN_IN_REJECTED',
        meta: { reason: result.reason },
      })
      return rejected()
    }

    const now = new Date()
    const { userId, tokenId } = result

    const user = await prisma.$transaction(async (tx) => {
      await markUserEmailVerified(tx, { userId, verifiedAt: now })

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          // pii-plaintext-read-ok: auth-response identity, parity with login
          email: true,
          role: true,
          authVersion: true,
          phoneVerifiedAt: true,
          emailVerifiedAt: true,
        },
      })
    })

    const isPhoneVerified = Boolean(user.phoneVerifiedAt)
    const isEmailVerified = Boolean(user.emailVerifiedAt)
    const isFullyVerified = isPhoneVerified && isEmailVerified

    /**
     * Same two-tier session shape as login and phone-login: a fully verified
     * account gets an active token, one still owing phone verification gets a
     * verification-scoped token so it lands on the phone step rather than
     * walking into the app half-verified.
     */
    const sessionToken = isFullyVerified
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

    logAuthEvent({
      level: 'info',
      event: 'auth.email_sign_in.verify.success',
      route: 'auth.emailSignIn.verify',
      userId: user.id,
      email: user.email,
      verificationId: tokenId,
      meta: { isPhoneVerified, isEmailVerified, isFullyVerified },
    })

    const response = jsonOk(
      {
        user: {
          id: user.id,
          email: user.email, // pii-plaintext-read-ok: auth-response identity, parity with login
          role: user.role,
        },
        token: sessionToken,
        nextUrl: null,
        isPhoneVerified,
        isEmailVerified,
        isFullyVerified,
      } satisfies AuthLoginResponseDTO,
      200,
    )

    setSessionCookie({ response, request, token: sessionToken })
    return response
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.email_sign_in.verify.failed',
      route: 'auth.emailSignIn.verify',
      code: 'INTERNAL',
      userId: null,
      email: null,
      error,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
