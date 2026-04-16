// app/api/auth/password-reset/request/route.ts

import { prisma } from '@/lib/prisma'
import {
  enforceRateLimit,
  jsonOk,
  normalizeEmail,
  rateLimitIdentity,
} from '@/app/api/_utils'
import {
  getPasswordResetAppUrlFromRequest,
  getPasswordResetRequestIp,
  issueAndSendPasswordReset,
} from '@/lib/auth/passwordReset'
import {
  logAuthEvent,
  captureAuthException,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'

type Body = { email?: unknown }

export async function POST(req: Request) {
  let emailForLog: string | null = null
  let userIdForLog: string | null = null

  try {
    const identity = await rateLimitIdentity()
    const rlRes = await enforceRateLimit({
      bucket: 'auth:password-reset-request',
      identity,
    })
    if (rlRes) return rlRes

    const body = (await req.json().catch(() => ({}))) as Body
    const email = normalizeEmail(body.email)
    emailForLog = email

    // Always return OK (no enumeration)
    if (!email) return jsonOk({ ok: true }, 200)

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    })

    // Still return OK even if not found
    if (!user) return jsonOk({ ok: true }, 200)

    userIdForLog = user.id

    const userEmail = normalizeEmail(user.email)
    emailForLog = userEmail

    // Still return OK if the matched user record no longer has a usable email
    if (!userEmail) return jsonOk({ ok: true }, 200)

    const appUrl = getPasswordResetAppUrlFromRequest(req)
    if (!appUrl) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.password_reset.request.app_url_missing',
        route: 'auth.passwordReset.request',
        userId: user.id,
        email: userEmail,
        code: 'APP_URL_MISSING',
      })
      return jsonOk({ ok: true }, 200)
    }

    const ip = getPasswordResetRequestIp(req)
    const userAgent = req.headers.get('user-agent') || null

    await issueAndSendPasswordReset({
      userId: user.id,
      email: userEmail,
      appUrl,
      ip,
      userAgent,
    })

    return jsonOk({ ok: true }, 200)
  } catch (err: unknown) {
    captureAuthException({
      event: 'auth.password_reset.request.failed',
      route: 'auth.passwordReset.request',
      code: 'INTERNAL',
      userId: userIdForLog,
      email: emailForLog,
      error: err,
    })

    // Still return OK to avoid leaking failure states to attackers
    return jsonOk({ ok: true }, 200)
  }
}