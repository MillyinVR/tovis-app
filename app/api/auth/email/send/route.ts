// app/api/auth/email/send/route.ts

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { enforceVerificationSendThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import {
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ResendEmailBody = {
  next?: unknown
  intent?: unknown
  inviteToken?: unknown
}

function normalizeRequiredEmailValue(value: string | null): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
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
  return value.length > 0 ? value : null
}

export async function POST(request: Request) {
  let userIdForLog: string | null = null

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

    const email = normalizeRequiredEmailValue(auth.user.email) // pii-plaintext-read-ok: email verification send requires the authenticated user's email destination

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
        code: 'APP_URL_MISSING',
      })

      return jsonFail(500, 'App URL is not configured.', {
        code: 'APP_URL_MISSING',
      })
    }

    const throttle = await enforceVerificationSendThrottle({
      userId: auth.user.id,
      phone: null,
    })

    if (!throttle.ok) {
      return throttle.response
    }

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = (rawBody ?? {}) as ResendEmailBody

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
      error,
    })

    return jsonFail(500, 'Could not send verification email.', {
      code: 'EMAIL_SEND_FAILED',
    })
  }
}