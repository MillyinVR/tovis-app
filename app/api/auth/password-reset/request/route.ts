// app/api/auth/password-reset/request/route.ts

import { Prisma } from '@prisma/client'

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
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'
import {
  emailLookupHash,
  emailLookupHashV2,
} from '@/lib/security/crypto/hashLookup'

export const dynamic = 'force-dynamic'

type Body = {
  email?: unknown
}

const PASSWORD_RESET_USER_SELECT = {
  id: true,
  email: true,
} satisfies Prisma.UserSelect

type PasswordResetUserRecord = Prisma.UserGetPayload<{
  select: typeof PASSWORD_RESET_USER_SELECT
}>

function buildPasswordResetLookupWhereConditions(
  email: string,
): Prisma.UserWhereInput[] {
  const emailHashV2 = emailLookupHashV2(email)
  const emailHash = emailLookupHash(email)

  const orConditions: Prisma.UserWhereInput[] = []

  if (emailHashV2) {
    orConditions.push({
      emailHashV2: emailHashV2.hash,
      emailHashKeyVersion: emailHashV2.keyVersion,
    })
  }

  /**
   * Legacy SHA-256 fallback for rows created before HMAC v2 backfill.
   * Remove after HMAC v2 burn-in and legacy hash column drop.
   */
  if (emailHash) {
    orConditions.push({ emailHash })
  }

  /**
   * Temporary plaintext fallback for local/dev databases and rows that predate
   * lookup hashes. Remove after contact hash v2 migration, backfill, and burn-in.
   */
  orConditions.push({ email })

  return orConditions
}

async function findPasswordResetUserByEmail(
  email: string,
): Promise<PasswordResetUserRecord | null> {
  const users = await prisma.user.findMany({
    where: {
      OR: buildPasswordResetLookupWhereConditions(email),
    },
    select: PASSWORD_RESET_USER_SELECT,
    take: 2,
  })

  if (users.length === 0) return null

  const uniqueUserIds = new Set(users.map((user) => user.id))

  /**
   * If lookup conditions match multiple users, fail closed without revealing
   * anything to the requester. Password reset must never guess an identity.
   */
  if (uniqueUserIds.size > 1) {
    return null
  }

  return users[0] ?? null
}

export async function POST(req: Request) {
  let emailForLog: string | null = null
  let userIdForLog: string | null = null

  try {
    const identity = await rateLimitIdentity()
    const rateLimitResponse = await enforceRateLimit({
      bucket: 'auth:password-reset-request',
      identity,
    })

    if (rateLimitResponse) return rateLimitResponse

    const body = (await req.json().catch(() => ({}))) as Body
    const email = normalizeEmail(body.email)

    emailForLog = email

    /**
     * Always return OK to prevent account enumeration.
     */
    if (!email) {
      return jsonOk({ ok: true }, 200)
    }

    const user = await findPasswordResetUserByEmail(email)

    /**
     * Still return OK even if no matching user exists.
     */
    if (!user) {
      return jsonOk({ ok: true }, 200)
    }

    userIdForLog = user.id

    const userEmail = normalizeEmail(user.email)
    emailForLog = userEmail

    /**
     * Still return OK if the matched user record no longer has a usable email.
     */
    if (!userEmail) {
      return jsonOk({ ok: true }, 200)
    }

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
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.password_reset.request.failed',
      route: 'auth.passwordReset.request',
      code: 'INTERNAL',
      userId: userIdForLog,
      email: emailForLog,
      error,
    })

    /**
     * Still return OK to avoid leaking failure states to attackers.
     */
    return jsonOk({ ok: true }, 200)
  }
}