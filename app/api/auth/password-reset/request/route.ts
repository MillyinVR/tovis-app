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

export const dynamic = 'force-dynamic'

type Body = { email?: unknown }

export async function POST(req: Request) {
  try {
    const identity = await rateLimitIdentity()
    const rlRes = await enforceRateLimit({
      bucket: 'auth:password-reset-request',
      identity,
    })
    if (rlRes) return rlRes

    const body = (await req.json().catch(() => ({}))) as Body
    const email = normalizeEmail(body.email)

    // Always return OK (no enumeration)
    if (!email) return jsonOk({ ok: true }, 200)

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    })

    // Still return OK even if not found
    if (!user) return jsonOk({ ok: true }, 200)

    const userEmail = normalizeEmail(user.email)

    // Still return OK if the matched user record no longer has a usable email
    if (!userEmail) return jsonOk({ ok: true }, 200)

    const appUrl = getPasswordResetAppUrlFromRequest(req)
    if (!appUrl) {
      console.error(
        '[password-reset] missing app URL (NEXT_PUBLIC_APP_URL or Host headers)',
      )
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
  } catch (err) {
    console.error('Password reset request error', err)
    // Still return OK to avoid leaking failure states to attackers
    return jsonOk({ ok: true }, 200)
  }
}