// app/api/auth/phone/correct/route.ts

import { Prisma } from '@prisma/client'

import {
  enforceRateLimit,
  jsonFail,
  jsonOk,
  phoneRateLimitIdentity,
  pickString,
} from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { startTwilioVerifyPhoneVerification } from '@/lib/twilio/verify'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'

import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from '@/lib/security/contactLookup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function updateUserPhone(args: {
  userId: string
  role: 'CLIENT' | 'PRO' | 'ADMIN'
  phone: string
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: args.userId },
      data: {
        phone: args.phone,
        ...buildUserContactLookupData({ phone: args.phone }),
        phoneVerifiedAt: null,
      },
    })

    if (args.role === 'CLIENT') {
      await tx.clientProfile.updateMany({
        where: { userId: args.userId },
        data: {
          phone: args.phone,
          ...buildClientProfileContactLookupData({ phone: args.phone }),
          phoneVerifiedAt: null,
        },
      })
    }

    if (args.role === 'PRO') {
      await tx.professionalProfile.updateMany({
        where: { userId: args.userId },
        data: {
          phone: args.phone,
          phoneVerifiedAt: null,
        },
      })
    }
  })
}

export async function POST(request: Request) {
  let userIdForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const user = auth.user
    const userId = user.id

    userIdForLog = userId
    phoneForLog = user.phone?.trim() ?? null

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

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

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

    await updateUserPhone({
      userId,
      role: user.role,
      phone: normalizedPhone,
    })

    const verifyResult = await startTwilioVerifyPhoneVerification({
      to: normalizedPhone,
    })

    if (!verifyResult.ok) {
      logAuthEvent({
        level:
          verifyResult.code === 'TWILIO_VERIFY_NOT_CONFIGURED'
            ? 'error'
            : 'warn',
        event: 'auth.phone.correct.verify_start_failed',
        route: 'auth.phone.correct',
        provider: 'twilio_verify',
        code: verifyResult.code,
        userId,
        phone: normalizedPhone,
        meta: {
          message: verifyResult.message,
        },
      })

      const status =
        verifyResult.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 503 : 502

      return jsonFail(
        status,
        'Phone number was updated, but we could not send a verification code. Please try resending the code.',
        {
          code: verifyResult.code,
          phone: normalizedPhone,
          sent: false,
          isPhoneVerified: false,
        },
      )
    }

    logAuthEvent({
      level: 'info',
      event: 'auth.phone.correct.success',
      route: 'auth.phone.correct',
      provider: 'twilio_verify',
      userId,
      phone: normalizedPhone,
      meta: {
        sid: verifyResult.sid,
        status: verifyResult.status,
      },
    })

    return jsonOk(
      {
        sent: true,
        phone: normalizedPhone,
        isPhoneVerified: false,
        isEmailVerified: user.isEmailVerified,
        isFullyVerified: false,
        requiresEmailVerification: !user.isEmailVerified,
      },
      200,
    )
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.phone.correct.duplicate',
        route: 'auth.phone.correct',
        code: 'PHONE_UPDATE_FAILED',
        userId: userIdForLog,
        phone: phoneForLog,
        meta: {
          prismaCode: error.code,
        },
      })

      return jsonFail(
        400,
        "We couldn't update to that phone number. Please try a different number.",
        {
          code: 'PHONE_UPDATE_FAILED',
        },
      )
    }

    captureAuthException({
      event: 'auth.phone.correct.internal_error',
      route: 'auth.phone.correct',
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