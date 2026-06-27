// app/api/v1/auth/phone-login/send/route.ts
//
// Passwordless phone login — step 1. Send a Twilio Verify code to a phone that
// belongs to an existing account. ENUMERATION-SAFE: the response is identical
// whether or not an account exists; we only actually send a code when one does.

import { jsonOk, jsonFail, pickString } from '@/app/api/_utils'
import { isRecord } from '@/lib/guards'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { enforceVerificationSendThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import { getVerificationPhoneLookupValue } from '@/lib/auth/verification'
import { startTwilioVerifyPhoneVerification } from '@/lib/twilio/verify'
import { findUserByPhoneForLogin } from '@/lib/auth/findUserByPhone'
import { captureAuthException, logAuthEvent } from '@/lib/observability/authEvents'
import type { AuthPhoneLoginSendResponseDTO } from '@/lib/dto/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const GENERIC_SENT = {
  message: 'If an account exists for that number, we sent a verification code.',
} satisfies AuthPhoneLoginSendResponseDTO

export async function POST(request: Request) {
  try {
    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}
    const phoneInput = pickString(body.phone) // pii-plaintext-read-ok: client-supplied phone, not a DB read

    if (!phoneInput) {
      return jsonFail(400, 'Phone number is required.', { code: 'PHONE_REQUIRED' })
    }

    // Format / allowed-country gate. This is about the number itself, not
    // account existence, so a 400 here leaks nothing.
    const country = validateSmsDestinationCountry(phoneInput)
    if (!country.ok) {
      return jsonFail(400, country.message, { code: country.code })
    }

    // IP + per-phone SMS throttle (keyed identically regardless of existence).
    const throttle = await enforceVerificationSendThrottle({ phone: phoneInput })
    if (!throttle.ok) return throttle.response

    const to = getVerificationPhoneLookupValue(phoneInput)
    const user = to ? await findUserByPhoneForLogin(phoneInput) : null

    if (user && to) {
      const result = await startTwilioVerifyPhoneVerification({ to })
      if (!result.ok) {
        logAuthEvent({
          level:
            result.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 'error' : 'warn',
          event: 'auth.phone_login.send.twilio_failed',
          route: 'auth.phone-login.send',
          provider: 'twilio_verify',
          code: result.code,
          userId: user.id,
          phone: phoneInput,
        })
        if (result.code === 'TWILIO_VERIFY_NOT_CONFIGURED') {
          return jsonFail(503, 'Phone sign-in is unavailable.', {
            code: result.code,
          })
        }
        // Transient send failure: keep the response generic so existence never
        // leaks; the user can retry.
      }
    }

    return jsonOk(GENERIC_SENT, 200)
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.phone_login.send.failed',
      route: 'auth.phone-login.send',
      code: 'INTERNAL',
      userId: null,
      email: null,
      error,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
