// app/api/auth/login/route.ts
import { prisma } from '@/lib/prisma'
import {
  DUMMY_PASSWORD_HASH,
  verifyPassword,
  createActiveToken,
  createVerificationToken,
} from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import {
  jsonFail,
  jsonOk,
  pickString,
  normalizeEmail,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { Prisma, Role } from '@prisma/client'
import { captureAuthException } from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'

type LoginBody = {
  email?: unknown
  password?: unknown
  tapIntentId?: unknown
  expectedRole?: unknown
}

const LOGIN_LOCK_THRESHOLD = 10
const LOGIN_LOCK_WINDOW_MS = 30 * 60 * 1000

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

type FailedLoginAttemptState = {
  loginAttempts: number
  lockedUntil: Date | string | null
}

function coerceDate(value: Date | string | null): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
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

function normalizeExpectedRole(raw: unknown): Role | null {
  const s = pickString(raw)?.trim().toUpperCase() ?? ''
  if (s === Role.ADMIN) return Role.ADMIN
  if (s === Role.PRO) return Role.PRO
  if (s === Role.CLIENT) return Role.CLIENT
  return null
}

function hostToHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null

  const first = hostHeader.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return null

  // Handle IPv6 like "[::1]:3000"
  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    if (end === -1) return null
    return first.slice(1, end)
  }

  // Strip port if present: "localhost:3000" -> "localhost"
  const idx = first.indexOf(':')
  return idx >= 0 ? first.slice(0, idx) : first
}

function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined

  // Share cookie across subdomains of tovis.app or tovis.me
  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) {
    return '.tovis.app'
  }
  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) {
    return '.tovis.me'
  }

  // localhost / other hosts: host-only cookie (no Domain attribute)
  return undefined
}

function resolveIsHttps(request: Request): boolean {
  // Prefer proxy headers (Vercel / reverse proxies)
  const xfProto = request.headers.get('x-forwarded-proto')?.trim().toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  // Fallback to request.url
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  let emailForLog: string | null = null
  let userIdForLog: string | null = null

  try {
    const identity = await rateLimitIdentity()
    const rlRes = await enforceRateLimit({ bucket: 'auth:login', identity })
    if (rlRes) return rlRes

    const body = (await request.json().catch(() => ({}))) as LoginBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const tapIntentId = pickString(body.tapIntentId)
    const expectedRole = normalizeExpectedRole(body.expectedRole)

    emailForLog = email

    if (!email || !password) {
      return jsonFail(400, 'Missing email or password', {
        code: 'MISSING_CREDENTIALS',
      })
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        authVersion: true,
        loginAttempts: true,
        lockedUntil: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        professionalProfile: { select: { id: true } },
        clientProfile: { select: { id: true } },
      },
    })

    const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH
    const isValid = await verifyPassword(password, passwordHash)

    if (!user) {
      return invalidCredentialsResponse()
    }

    userIdForLog = user.id

    const now = new Date()

    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      return accountLockedResponse(
        getRetryAfterSeconds(user.lockedUntil, now),
      )
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

    // Correct password path starts here.
    // Clear partial/expired lockout state before downstream business checks
    // so lockout tracks password failures, not later authorization/setup gates.
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
        })
      : createVerificationToken({
          userId: clearedUser.id,
          role: clearedUser.role,
          authVersion: clearedUser.authVersion,
        })

    const consumed = await consumeTapIntent({
      tapIntentId: tapIntentId ?? null,
      userId: clearedUser.id,
    })

    const res = jsonOk(
      {
        user: {
          id: clearedUser.id,
          email: clearedUser.email,
          role: clearedUser.role,
        },
        nextUrl: consumed?.nextUrl ?? null,
        isPhoneVerified: Boolean(clearedUser.phoneVerifiedAt),
        isEmailVerified: Boolean(clearedUser.emailVerifiedAt),
        isFullyVerified,
      },
      200,
    )

    const hostname = hostToHostname(
      request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
    )
    const cookieDomain = resolveCookieDomain(hostname)
    const isHttps = resolveIsHttps(request)

    res.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    })

    return res
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.login.failed',
      route: 'auth.login',
      code: 'INTERNAL',
      userId: userIdForLog,
      email: emailForLog,
      error,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}