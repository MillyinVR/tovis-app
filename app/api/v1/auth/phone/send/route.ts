// app/api/v1/auth/phone/send/route.ts

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { enforceVerificationSendThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { startTwilioVerifyPhoneVerification } from '@/lib/twilio/verify'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_request: Request) {
  let userIdForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const user = auth.user
    const userId = user.id

    userIdForLog = userId

    if (user.phoneVerifiedAt) {
      return jsonOk(
        {
          alreadyVerified: true,
          sent: false,
          isPhoneVerified: true,
          isEmailVerified: user.isEmailVerified,
          isFullyVerified: user.isFullyVerified,
          requiresEmailVerification: !user.isEmailVerified,
        },
        200,
      )
    }

    const phone = user.phone?.trim() ?? ''
    phoneForLog = phone || null

    if (!phone) {
      return jsonFail(400, 'Phone number missing.', {
        code: 'PHONE_REQUIRED',
      })
    }

    if (await isRuntimeFlagEnabled('sms_disabled')) {
      return jsonFail(503, 'SMS verification is temporarily unavailable.', {
        code: 'SMS_DISABLED',
      })
    }

    const smsCountry = validateSmsDestinationCountry(phone)

    if (!smsCountry.ok) {
      return jsonFail(400, smsCountry.message, {
        code: smsCountry.code,
        countryCode: smsCountry.countryCode,
      })
    }

    const normalizedPhone = smsCountry.phone
    phoneForLog = normalizedPhone

    const throttle = await enforceVerificationSendThrottle({
      userId,
      phone: normalizedPhone,
    })

    if (!throttle.ok) {
      return throttle.response
    }

    const result = await startTwilioVerifyPhoneVerification({
      to: normalizedPhone,
    })

    if (!result.ok) {
      logAuthEvent({
        level:
          result.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 'error' : 'warn',
        event: 'auth.phone.send.failed',
        route: 'auth.phone.send',
        provider: 'twilio_verify',
        code: result.code,
        userId,
        phone: normalizedPhone,
        meta: {
          message: result.message,
        },
      })

      const status =
        result.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 503 : 502

      return jsonFail(
        status,
        'Could not send verification code. Please try again.',
        {
          code: result.code,
        },
      )
    }

    logAuthEvent({
      level: 'info',
      event: 'auth.phone.send.success',
      route: 'auth.phone.send',
      provider: 'twilio_verify',
      userId,
      phone: normalizedPhone,
      meta: {
        sid: result.sid,
        status: result.status,
      },
    })

    return jsonOk(
      {
        sent: true,
        isPhoneVerified: false,
        isEmailVerified: user.isEmailVerified,
        isFullyVerified: false,
        requiresEmailVerification: !user.isEmailVerified,
      },
      200,
    )
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.phone.send.internal_error',
      route: 'auth.phone.send',
      provider: 'twilio_verify',
      code: 'INTERNAL',
      userId: userIdForLog,
      phone: phoneForLog,
      error,
    })

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}