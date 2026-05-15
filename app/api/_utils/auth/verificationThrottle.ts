// app/api/_utils/auth/verificationThrottle.ts
import {
  enforceRateLimit,
  phoneRateLimitIdentity,
  rateLimitIdentity,
  tokenRateLimitIdentity,
} from '@/app/api/_utils/rateLimit'
import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'

type VerificationThrottleResult =
  | {
      ok: true
    }
  | {
      ok: false
      response: Response
    }

export type VerificationVerifyThrottleScope = 'phone-verify' | 'email-verify'
function verificationVerifyBucketForScope(
  scope: VerificationVerifyThrottleScope,
): 'auth:phone:verify' | 'auth:email:verify' {
  return scope === 'phone-verify' ? 'auth:phone:verify' : 'auth:email:verify'
}

export async function enforceVerificationVerifyThrottle(args: {
  request: Request
  scope: VerificationVerifyThrottleScope
  subjectKey: string
}): Promise<Response | null> {
  const subjectKey = args.subjectKey.trim()

  if (!subjectKey) {
    throw new Error(
      'enforceVerificationVerifyThrottle requires a non-empty subjectKey.',
    )
  }

  const ip = getTrustedClientIpFromRequest(args.request) ?? 'unknown'

  return enforceRateLimit({
    bucket: verificationVerifyBucketForScope(args.scope),
    identity: tokenRateLimitIdentity(`${args.scope}:${subjectKey}:ip:${ip}`),
  })
}

export async function enforceVerificationSendThrottle(args: {
  userId?: string | null
  phone?: string | null
}): Promise<VerificationThrottleResult> {
  const identity = await rateLimitIdentity(args.userId)

  const ipLimited = await enforceRateLimit({
    bucket: 'auth:email:send',
    identity,
  })

  if (ipLimited) {
    return {
      ok: false,
      response: ipLimited,
    }
  }

  const phone = args.phone?.trim()

  if (!phone) {
    return { ok: true }
  }

  const phoneLimited = await enforceRateLimit({
    bucket: 'auth:sms-phone-hour',
    identity: phoneRateLimitIdentity(phone),
  })

  if (phoneLimited) {
    return {
      ok: false,
      response: phoneLimited,
    }
  }

  const phoneDailyLimited = await enforceRateLimit({
    bucket: 'auth:sms-phone-day',
    identity: phoneRateLimitIdentity(phone),
  })

  if (phoneDailyLimited) {
    return {
      ok: false,
      response: phoneDailyLimited,
    }
  }

  return { ok: true }
}