// app/api/v1/auth/login/route.ts

import { Prisma, Role } from '@prisma/client'

import {
  emailRateLimitKeySuffix,
  enforceRateLimit,
  jsonFail,
  jsonOk,
  pickString,
  rateLimitIdentity,
} from '@/app/api/_utils'
import type { AuthLoginResponseDTO } from '@/lib/dto/auth'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import {
  createActiveToken,
  createVerificationToken,
  DUMMY_PASSWORD_HASH,
  verifyPassword,
} from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { captureAuthException } from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'
import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'

export const dynamic = 'force-dynamic'

type LoginBody = {
  email?: unknown
  password?: unknown
  tapIntentId?: unknown
  expectedRole?: unknown
  deviceId?: unknown
}

const LOGIN_LOCK_THRESHOLD = 10
const LOGIN_LOCK_WINDOW_MS = 30 * 60 * 1000

const LOGIN_USER_SELECT = {
  id: true,
  email: true,
  password: true,
  role: true,
  authVersion: true,
  loginAttempts: true,
  lockedUntil: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
  professionalProfile: {
    select: {
      id: true,
    },
  },
  clientProfile: {
    select: {
      id: true,
    },
  },
} satisfies Prisma.UserSelect

type LoginUserRecord = Prisma.UserGetPayload<{
  select: typeof LOGIN_USER_SELECT
}>

type FailedLoginAttemptState = {
  loginAttempts: number
  lockedUntil: Date | string | null
}

function invalidCredentialsResponse() {
  return jsonFail(401, 'Invalid credentials', {
    code: 'INVALID_CREDENTIALS',
  })
}

function accountLockedResponse(retryAfter: number) {
  return jsonFail(400, 'Too many login attempts. Try again later.', {
    code: 'ACCOUNT_LOCKED',
    retryAfter,
  })
}

function getRetryAfterSeconds(lockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000))
}

function coerceDate(value: Date | string | null): Date | null {
  if (value instanceof Date) return value

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function normalizeExpectedRole(raw: unknown): Role | null {
  const value = pickString(raw)?.trim().toUpperCase() ?? ''

  if (value === Role.ADMIN) return Role.ADMIN
  if (value === Role.PRO) return Role.PRO
  if (value === Role.CLIENT) return Role.CLIENT

  return null
}

function hostToHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null

  const first = hostHeader.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return null

  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    if (end === -1) return null
    return first.slice(1, end)
  }

  const portIndex = first.indexOf(':')
  return portIndex >= 0 ? first.slice(0, portIndex) : first
}

function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined

  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) {
    return '.tovis.app'
  }

  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) {
    return '.tovis.me'
  }

  return undefined
}

function resolveIsHttps(request: Request): boolean {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.trim()
    .toLowerCase()

  if (forwardedProto === 'https') return true
  if (forwardedProto === 'http') return false

  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function buildLoginLookupWhereConditions(
  email: string,
): Prisma.UserWhereInput[] {
  const emailHashV2 = emailLookupHashV2(email)

  if (!emailHashV2) return []

  return [
    {
      emailHashV2: emailHashV2.hash,
      emailHashKeyVersion: emailHashV2.keyVersion,
    },
  ]
}

async function findLoginUserByEmail(
  email: string,
): Promise<LoginUserRecord | null> {
  const users = await prisma.user.findMany({
    where: {
      OR: buildLoginLookupWhereConditions(email),
    },
    select: LOGIN_USER_SELECT,
    take: 2,
  })

  if (users.length === 0) return null

  const uniqueUserIds = new Set(users.map((user) => user.id))

  if (uniqueUserIds.size > 1) {
    return null
  }

  return users[0] ?? null
}

async function recordFailedLoginAttempt(
  userId: string,
  now: Date,
): Promise<FailedLoginAttemptState> {
  const lockUntil = new Date(now.getTime() + LOGIN_LOCK_WINDOW_MS)

  const rows = await prisma.$queryRaw<FailedLoginAttemptState[]>(Prisma.sql`
    UPDATE "User"
    SET
      "loginAttempts" = CASE
        WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" > ${now} THEN "loginAttempts"
        WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= ${now} THEN 1
        ELSE "loginAttempts" + 1
      END,
      "lockedUntil" = CASE
        WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" > ${now} THEN "lockedUntil"
        WHEN (
          CASE
            WHEN "lockedUntil" IS NOT NULL AND "lockedUntil" <= ${now} THEN 1
            ELSE "loginAttempts" + 1
          END
        ) >= ${LOGIN_LOCK_THRESHOLD}
        THEN ${lockUntil}
        ELSE NULL
      END
    WHERE "id" = ${userId}
    RETURNING "loginAttempts", "lockedUntil"
  `)

  const row = rows[0]
  if (!row) {
    throw new Error('Failed to record login attempt state')
  }

  return row
}

async function clearLoginLockState(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      loginAttempts: 0,
      lockedUntil: null,
    },
    select: {
      id: true,
      email: true,
      role: true,
      authVersion: true,
      phoneVerifiedAt: true,
      emailVerifiedAt: true,
    },
  })
}

export async function POST(request: Request) {
  let emailForLog: string | null = null
  let userIdForLog: string | null = null

  try {
    const identity = await rateLimitIdentity()
    const rateLimitResponse = await enforceRateLimit({
      bucket: 'auth:login',
      identity,
    })

    if (rateLimitResponse) return rateLimitResponse

    const body = (await request.json().catch(() => ({}))) as LoginBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const tapIntentId = pickString(body.tapIntentId)
    const expectedRole = normalizeExpectedRole(body.expectedRole)
    // Native clients send a stable per-install id so the session can be revoked
    // per-device; web omits it.
    const deviceId = pickString(body.deviceId)

    emailForLog = email

    if (!email || !password) {
      return jsonFail(400, 'Missing email or password', {
        code: 'MISSING_CREDENTIALS',
      })
    }

    // Tight per-account brute-force guard, keyed by IP+email (composite, so a
    // remote attacker can't lock the account out — see policies.ts). Enforced
    // only once we have a well-formed email, before any password verification.
    const identityRateLimitResponse = await enforceRateLimit({
      bucket: 'auth:login:identity',
      identity,
      keySuffix: emailRateLimitKeySuffix(email),
    })

    if (identityRateLimitResponse) return identityRateLimitResponse

    const user = await findLoginUserByEmail(email)
    const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH
    const isValid = await verifyPassword(password, passwordHash)

    if (!user) {
      return invalidCredentialsResponse()
    }

    userIdForLog = user.id

    const now = new Date()

    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      return accountLockedResponse(getRetryAfterSeconds(user.lockedUntil, now))
    }

    if (!isValid) {
      const failedState = await recordFailedLoginAttempt(user.id, now)
      const failedLockedUntil = coerceDate(failedState.lockedUntil)

      if (failedLockedUntil && failedLockedUntil.getTime() > now.getTime()) {
        return accountLockedResponse(
          getRetryAfterSeconds(failedLockedUntil, now),
        )
      }

      return invalidCredentialsResponse()
    }

    const clearedUser = await clearLoginLockState(user.id)

    if (expectedRole && clearedUser.role !== expectedRole) {
      return jsonFail(
        403,
        `That account is not a ${expectedRole.toLowerCase()} account.`,
        {
          code: 'ROLE_MISMATCH',
          expectedRole,
          actualRole: clearedUser.role,
        },
      )
    }

    if (clearedUser.role === Role.PRO && !user.professionalProfile?.id) {
      return jsonFail(409, 'Professional setup is not complete yet.', {
        code: 'PRO_SETUP_REQUIRED',
      })
    }

    const isFullyVerified = Boolean(
      clearedUser.phoneVerifiedAt && clearedUser.emailVerifiedAt,
    )

    const token = isFullyVerified
      ? createActiveToken({
          userId: clearedUser.id,
          role: clearedUser.role,
          authVersion: clearedUser.authVersion,
          deviceId,
        })
      : createVerificationToken({
          userId: clearedUser.id,
          role: clearedUser.role,
          authVersion: clearedUser.authVersion,
          deviceId,
        })

    const consumed = await consumeTapIntent({
      tapIntentId: tapIntentId ?? null,
      userId: clearedUser.id,
    })

    const response = jsonOk(
      {
        user: {
          id: clearedUser.id,
          email: clearedUser.email,
          role: clearedUser.role,
        },
        // Native clients have no cookie jar — they persist this token in
        // secure storage and replay it as `Authorization: Bearer`. Web ignores
        // it and uses the httpOnly cookie set below.
        token,
        nextUrl: consumed?.nextUrl ?? null,
        isPhoneVerified: Boolean(clearedUser.phoneVerifiedAt),
        isEmailVerified: Boolean(clearedUser.emailVerifiedAt),
        isFullyVerified,
      } satisfies AuthLoginResponseDTO,
      200,
    )

    const hostname = hostToHostname(
      request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    )
    const cookieDomain = resolveCookieDomain(hostname)
    const isHttps = resolveIsHttps(request)

    response.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    })

    return response
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.login.failed',
      route: 'auth.login',
      code: 'INTERNAL',
      userId: userIdForLog,
      email: emailForLog,
      error,
    })

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}