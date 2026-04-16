// app/api/auth/phone/correct/route.ts
import { Prisma } from '@prisma/client'

import {
  jsonFail,
  jsonOk,
  enforceRateLimit,
  phoneRateLimitIdentity,
  pickString,
} from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  enforcePhoneVerificationOtpLimits,
  issueAndSendPhoneVerificationCode,
  readPhoneSendErrorCode,
} from '@/app/api/_utils/auth/phoneVerificationSend'
import { prisma } from '@/lib/prisma'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CorrectPhoneBody = {
  phone?: unknown
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    if (auth.user.phoneVerifiedAt) {
      return jsonOk({ alreadyVerified: true, sent: false }, 200)
    }

    const body = ((await request.json().catch(() => ({}))) ?? {}) as CorrectPhoneBody
    const rawPhone = pickString(body.phone)?.trim() ?? null

    if (!rawPhone) {
      return jsonFail(400, 'Phone number missing.', {
        code: 'PHONE_REQUIRED',
      })
    }

    if (await isRuntimeFlagEnabled('sms_disabled')) {
      return jsonFail(503, 'SMS verification is temporarily unavailable.', {
        code: 'SMS_DISABLED',
      })
    }

    const smsCountry = validateSmsDestinationCountry(rawPhone)
    if (!smsCountry.ok) {
      return jsonFail(400, smsCountry.message, {
        code: smsCountry.code,
        countryCode: smsCountry.countryCode,
      })
    }

    const normalizedPhone = smsCountry.phone
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

    const limit = await enforcePhoneVerificationOtpLimits(auth.user.id)
    if (!limit.ok) {
      const res = jsonFail(429, 'Too many requests. Try again shortly.', {
        code: 'RATE_LIMITED',
        retryAfterSeconds: limit.retryAfterSeconds,
      })
      res.headers.set('Retry-After', String(limit.retryAfterSeconds))
      return res
    }

    await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        phone: normalizedPhone,
        phoneVerifiedAt: null,
      },
    })

    await issueAndSendPhoneVerificationCode({
      userId: auth.user.id,
      phone: normalizedPhone,
    })

    return jsonOk(
      {
        sent: true,
        phone: normalizedPhone,
        isPhoneVerified: false,
        isEmailVerified: auth.user.isEmailVerified,
        isFullyVerified: false,
      },
      200,
    )
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return jsonFail(409, 'That phone number is already in use.', {
        code: 'PHONE_IN_USE',
      })
    }

    const code = readPhoneSendErrorCode(error)

    if (code === 'SMS_NOT_CONFIGURED') {
      console.error('[phone/correct] twilio env missing', error)
      return jsonFail(500, 'SMS provider is not configured.', { code })
    }

    if (code === 'SMS_SEND_FAILED') {
      console.error('[phone/correct] send failed', error)
      return jsonFail(502, 'Could not send verification code. Please try again.', {
        code,
      })
    }

    console.error('[phone/correct] error', error)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}