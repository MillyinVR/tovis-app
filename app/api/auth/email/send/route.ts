import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import {
  enforceEmailVerificationLimits,
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'
import {
  logAuthEvent,
  captureAuthException,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ResendEmailBody = {
  next?: unknown
  intent?: unknown
  inviteToken?: unknown
}

function normalizeEmail(value: string | null): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function sanitizeInternalPath(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  return value
}

function sanitizeOptionalText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  return value || null
}

export async function POST(request: Request) {
  let userIdForLog: string | null = null
  let emailForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    userIdForLog = auth.user.id

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

    const email = normalizeEmail(auth.user.email)
    emailForLog = email

    if (!email) {
      return jsonFail(400, 'Email address missing.', {
        code: 'EMAIL_REQUIRED',
      })
    }

    const appUrl = getAppUrlFromRequest(request)
    if (!appUrl) {
      logAuthEvent({
        level: 'error',
        event: 'auth.email.send.app_url_missing',
        route: 'auth.email.send',
        userId: auth.user.id,
        email,
        code: 'APP_URL_MISSING',
      })

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

    const body = ((await request.json().catch(() => ({}))) ??
      {}) as ResendEmailBody

    const nextForVerification = sanitizeInternalPath(pickString(body.next))
    const verificationIntent = sanitizeOptionalText(pickString(body.intent))
    const verificationInviteToken = sanitizeOptionalText(
      pickString(body.inviteToken),
    )

    await issueAndSendEmailVerification({
      userId: auth.user.id,
      email,
      appUrl,
      next: nextForVerification,
      intent: verificationIntent,
      inviteToken: verificationInviteToken,
    })

    return jsonOk(
      {
        sent: true,
        isPhoneVerified: auth.user.isPhoneVerified,
        isEmailVerified: false,
        isFullyVerified: false,
        nextUrl: nextForVerification,
      },
      200,
    )
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error'

    if (message.includes('Missing env var: POSTMARK_')) {
      captureAuthException({
        event: 'auth.email.send.failed',
        route: 'auth.email.send',
        provider: 'postmark',
        code: 'EMAIL_NOT_CONFIGURED',
        userId: userIdForLog,
        email: emailForLog,
        error,
      })

      return jsonFail(500, 'Email provider is not configured.', {
        code: 'EMAIL_NOT_CONFIGURED',
      })
    }

    captureAuthException({
      event: 'auth.email.send.failed',
      route: 'auth.email.send',
      provider: 'postmark',
      code: 'EMAIL_SEND_FAILED',
      userId: userIdForLog,
      email: emailForLog,
      error,
    })

    return jsonFail(500, 'Could not send verification email.', {
      code: 'EMAIL_SEND_FAILED',
    })
  }
}