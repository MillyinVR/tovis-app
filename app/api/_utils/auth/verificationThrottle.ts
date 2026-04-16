// app/api/_utils/auth/verificationThrottle.ts
import { jsonFail } from '@/app/api/_utils'
import { rateLimitRedis } from '@/lib/rateLimitRedis'
import { getTrustedClientIpFromRequest } from '@/lib/trustedClientIp'

const VERIFY_LIMIT = 10
const VERIFY_WINDOW_SECONDS = 10 * 60

export type VerificationThrottleScope = 'phone-verify' | 'email-verify'

export async function enforceVerificationVerifyThrottle(args: {
  request: Request
  scope: VerificationThrottleScope
  subjectKey: string
}) {
  const ip = getTrustedClientIpFromRequest(args.request) ?? 'unknown'
  const key = `auth:verify:${args.scope}:${args.subjectKey}:ip:${ip}`

  try {
    const result = await rateLimitRedis({
      key,
      limit: VERIFY_LIMIT,
      windowSeconds: VERIFY_WINDOW_SECONDS,
    })

    if (result.success) return null

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((result.resetMs - Date.now()) / 1000),
    )

    return jsonFail(
      429,
      'Too many verification attempts. Please wait and try again.',
      {
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      },
      {
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(result.resetMs),
        },
      },
    )
  } catch (error) {
    console.warn('[verification-throttle] skipped (redis error):', error)
    return null
  }
}