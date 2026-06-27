// app/api/v1/auth/phone-login/verify/route.ts
//
// Passwordless phone login — step 2. Verify the Twilio code for a phone that
// belongs to an existing account, then mint the SAME session payload as login.
// Successful verification proves control of the number, so a not-yet-verified
// phone is marked verified here.

import {
  jsonOk,
  jsonFail,
  pickString,
  rateLimitIdentity,
  enforceRateLimit,
} from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { getVerificationPhoneLookupValue } from '@/lib/auth/verification'
import { checkTwilioVerifyPhoneCode } from '@/lib/twilio/verify'
import { findUserByPhoneForLogin } from '@/lib/auth/findUserByPhone'
import { createActiveToken, createVerificationToken } from '@/lib/auth'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { captureAuthException } from '@/lib/observability/authEvents'
import type { AuthLoginResponseDTO } from '@/lib/dto/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const identity = await rateLimitIdentity()
    const limited = await enforceRateLimit({ bucket: 'auth:phone-login', identity })
    if (limited) return limited

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const phoneInput = pickString(body.phone) // pii-plaintext-read-ok: client-supplied phone, not a DB read
    const code = pickString(body.code)?.trim() ?? ''
    const deviceId = pickString(body.deviceId)

    if (!phoneInput || !code) {
      return jsonFail(400, 'Phone number and code are required.', {
        code: 'MISSING_FIELDS',
      })
    }
    if (!/^\d{6}$/.test(code)) {
      return jsonFail(400, 'Invalid code format.', { code: 'CODE_INVALID' })
    }

    const country = validateSmsDestinationCountry(phoneInput)
    if (!country.ok) {
      return jsonFail(400, country.message, { code: country.code })
    }

    const to = getVerificationPhoneLookupValue(phoneInput)
    const user = to ? await findUserByPhoneForLogin(phoneInput) : null

    // Uniform rejection for "no account" and "wrong code" so existence never leaks.
    const rejected = () =>
      jsonFail(400, 'Incorrect or expired code.', { code: 'CODE_REJECTED' })

    if (!user || !to) return rejected()

    const check = await checkTwilioVerifyPhoneCode({ to, code })
    if (!check.ok) {
      const status = check.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 503 : 502
      return jsonFail(status, 'Phone sign-in is unavailable.', {
        code: check.code,
      })
    }
    if (!check.approved) return rejected()

    // Verified control of the number → mark the phone verified if it wasn't.
    let phoneVerifiedAt = user.phoneVerifiedAt
    if (!phoneVerifiedAt) {
      const now = new Date()
      await prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: now },
      })
      phoneVerifiedAt = now
    }

    const isFullyVerified = Boolean(phoneVerifiedAt && user.emailVerifiedAt)
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
        isPhoneVerified: true,
        isEmailVerified: Boolean(user.emailVerifiedAt),
        isFullyVerified,
      } satisfies AuthLoginResponseDTO,
      200,
    )

    setSessionCookie({ response, request, token })
    return response
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.phone_login.verify.failed',
      route: 'auth.phone-login.verify',
      code: 'INTERNAL',
      userId: null,
      email: null,
      error,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
