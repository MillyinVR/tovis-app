// app/api/auth/phone/send/route.ts
import {
  jsonFail,
  jsonOk,
  enforceRateLimit,
  phoneRateLimitIdentity,
} from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  enforcePhoneVerificationOtpLimits,
  issueAndSendPhoneVerificationCode,
  readPhoneSendErrorCode,
} from '@/app/api/_utils/auth/phoneVerificationSend'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { captureAuthException } from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_request: Request) {
  let userIdForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const userId = auth.user.id
    userIdForLog = userId

    if (auth.user.phoneVerifiedAt) {
      return jsonOk({ alreadyVerified: true, sent: false }, 200)
    }

    const phone = (auth.user.phone ?? '').trim()
    phoneForLog = phone || null

    if (!phone) {
      return jsonFail(400, 'Phone number missing.', { code: 'PHONE_REQUIRED' })
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

    const phoneIdentity = phoneRateLimitIdentity(normalizedPhone)

    const smsPhoneHourRes = await enforceRateLimit({
      bucket: 'auth:sms-phone-hour',
      identity: phoneIdentity,
    })
    if (smsPhoneHourRes) return smsPhoneHourRes

    const smsPhoneDayRes = await enforceRateLimit({
      bucket: 'auth:sms-phone-day',
      identity: phoneIdentity,
    })
    if (smsPhoneDayRes) return smsPhoneDayRes

    const limit = await enforcePhoneVerificationOtpLimits(userId)
    if (!limit.ok) {
      const res = jsonFail(429, 'Too many requests. Try again shortly.', {
        code: 'RATE_LIMITED',
        retryAfterSeconds: limit.retryAfterSeconds,
      })
      res.headers.set('Retry-After', String(limit.retryAfterSeconds))
      return res
    }

    await issueAndSendPhoneVerificationCode({
      userId,
      phone: normalizedPhone,
    })

    return jsonOk({ sent: true }, 200)
  } catch (err: unknown) {
    const code = readPhoneSendErrorCode(err)

    if (code === 'SMS_NOT_CONFIGURED') {
      captureAuthException({
        event: 'auth.phone.send.not_configured',
        route: 'auth.phone.send',
        provider: 'twilio',
        code,
        userId: userIdForLog,
        phone: phoneForLog,
        error: err,
      })
      return jsonFail(500, 'SMS provider is not configured.', { code })
    }

    if (code === 'SMS_SEND_FAILED') {
      captureAuthException({
        event: 'auth.phone.send.failed',
        route: 'auth.phone.send',
        provider: 'twilio',
        code,
        userId: userIdForLog,
        phone: phoneForLog,
        error: err,
      })
      return jsonFail(
        502,
        'Could not send verification code. Please try again.',
        {
          code,
        },
      )
    }

    captureAuthException({
      event: 'auth.phone.send.internal_error',
      route: 'auth.phone.send',
      code: 'INTERNAL',
      userId: userIdForLog,
      phone: phoneForLog,
      error: err,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}