import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  enforceEmailVerificationLimits,
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    if (auth.user.emailVerifiedAt) {
      return jsonOk(
        {
          alreadyVerified: true,
          isPhoneVerified: auth.user.isPhoneVerified,
          isEmailVerified: true,
          isFullyVerified: auth.user.isFullyVerified,
        },
        200,
      )
    }

    const email = auth.user.email.trim()
    if (!email) {
      return jsonFail(400, 'Email address missing.', {
        code: 'EMAIL_REQUIRED',
      })
    }

    const appUrl = getAppUrlFromRequest(request)
    if (!appUrl) {
      console.error('[auth/email/send] missing app URL')
      return jsonFail(500, 'App URL is not configured.', {
        code: 'APP_URL_MISSING',
      })
    }

    const limit = await enforceEmailVerificationLimits(auth.user.id)
    if (!limit.ok) {
      const res = jsonFail(429, 'Too many requests. Try again shortly.', {
        code: 'RATE_LIMITED',
        retryAfterSeconds: limit.retryAfterSeconds,
      })
      res.headers.set('Retry-After', String(limit.retryAfterSeconds))
      return res
    }

    await issueAndSendEmailVerification({
      userId: auth.user.id,
      email,
      appUrl,
    })

    return jsonOk(
      {
        sent: true,
        isPhoneVerified: auth.user.isPhoneVerified,
        isEmailVerified: false,
        isFullyVerified: false,
      },
      200,
    )
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    console.error('[auth/email/send] error', message)

    if (message.includes('Missing env var: POSTMARK_')) {
      return jsonFail(500, 'Email provider is not configured.', {
        code: 'EMAIL_NOT_CONFIGURED',
      })
    }

    return jsonFail(500, 'Could not send verification email.', {
      code: 'EMAIL_SEND_FAILED',
    })
  }
}