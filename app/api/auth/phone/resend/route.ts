// app/api/auth/phone/resend/route.ts

import {
  enforceRateLimit,
  jsonFail,
  jsonOk,
  phoneRateLimitIdentity,
  rateLimitIdentity,
} from '@/app/api/_utils'
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

export async function POST(request: Request) {
  let userIdForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const user = auth.user
    const userId = user.id
    const phone = user.phone?.trim() ?? ''

    userIdForLog = userId
    phoneForLog = phone || null

    if (user.phoneVerifiedAt) {
      return jsonOk(
        {
          ok: true,
          alreadyVerified: true,
          isPhoneVerified: true,
          isEmailVerified: user.isEmailVerified,
          isFullyVerified: user.isFullyVerified,
          requiresEmailVerification: !user.isEmailVerified,
          phoneVerificationSent: false,
        },
        200,
      )
    }

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

    const identity = await rateLimitIdentity()

    const resendIpLimit = await enforceRateLimit({
      bucket: 'auth:register',
      identity,
    })

    if (resendIpLimit) return resendIpLimit

    const phoneIdentity = phoneRateLimitIdentity(phone)

    const smsPhoneHourLimit = await enforceRateLimit({
      bucket: 'auth:sms-phone-hour',
      identity: phoneIdentity,
    })

    if (smsPhoneHourLimit) return smsPhoneHourLimit

    const smsPhoneDayLimit = await enforceRateLimit({
      bucket: 'auth:sms-phone-day',
      identity: phoneIdentity,
    })

    if (smsPhoneDayLimit) return smsPhoneDayLimit

    const result = await startTwilioVerifyPhoneVerification({
      to: phone,
    })

    if (!result.ok) {
      logAuthEvent({
        level:
          result.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 'error' : 'warn',
        event: 'auth.phone.resend.failed',
        route: 'auth.phone.resend',
        provider: 'twilio_verify',
        code: result.code,
        userId,
        phone,
        meta: {
          message: result.message,
        },
      })

      const status =
        result.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 503 : 502

      return jsonFail(status, 'Phone verification is unavailable.', {
        code: result.code,
      })
    }

    logAuthEvent({
      level: 'info',
      event: 'auth.phone.resend.success',
      route: 'auth.phone.resend',
      provider: 'twilio_verify',
      userId,
      phone,
      meta: {
        sid: result.sid,
        status: result.status,
      },
    })

    return jsonOk(
      {
        ok: true,
        phoneVerificationSent: true,
        isPhoneVerified: false,
        isEmailVerified: user.isEmailVerified,
        isFullyVerified: false,
        requiresEmailVerification: !user.isEmailVerified,
      },
      200,
    )
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.phone.resend.failed',
      route: 'auth.phone.resend',
      provider: 'twilio_verify',
      userId: userIdForLog,
      phone: phoneForLog,
      code: 'INTERNAL',
      error,
    })

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}