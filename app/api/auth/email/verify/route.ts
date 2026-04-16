import { cookies } from 'next/headers'
import { AuthVerificationPurpose, Prisma } from '@prisma/client'

import {
  createActiveToken,
  createVerificationToken,
  verifyToken,
} from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { enforceVerificationVerifyThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import { sha256Hex, timingSafeEqualHex } from '@/lib/auth/timingSafe'
import {
  logAuthEvent,
  captureAuthException,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_VERIFY_ATTEMPTS = 5

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readVerificationBody(request: Request): Promise<{
  verificationId: string | null
  token: string | null
}> {
  const raw: unknown = await request.json().catch(() => ({}))
  const body = isRecord(raw) ? raw : {}

  const verificationId = pickString(body.verificationId)?.trim() ?? null
  const token = pickString(body.token)?.trim() ?? null

  return {
    verificationId:
      verificationId && verificationId.length > 0 ? verificationId : null,
    token: token && token.length > 0 ? token : null,
  }
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value ?? null
  if (!token) return null

  const payload = verifyToken(token)
  return payload?.userId ?? null
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

  const idx = first.indexOf(':')
  return idx >= 0 ? first.slice(0, idx) : first
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
  const xfProto = request.headers.get('x-forwarded-proto')?.trim().toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function getRequestHostname(request: Request): string | null {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return hostToHostname(host)
}

export async function POST(request: Request) {
  let verificationIdForLog: string | null = null
  let userIdForLog: string | null = null
  let emailForLog: string | null = null

  try {
    const { verificationId, token } = await readVerificationBody(request)
    verificationIdForLog = verificationId

    if (!verificationId) {
      return jsonFail(400, 'Verification token is required.', {
        code: 'TOKEN_REQUIRED',
      })
    }

    if (!token) {
      return jsonFail(400, 'Verification token is required.', {
        code: 'TOKEN_REQUIRED',
      })
    }

    const throttleRes = await enforceVerificationVerifyThrottle({
      request,
      scope: 'email-verify',
      subjectKey: verificationId,
    })
    if (throttleRes) return throttleRes

    const now = new Date()

    const record = await prisma.emailVerificationToken.findUnique({
      where: { id: verificationId },
      select: {
        id: true,
        userId: true,
        purpose: true,
        email: true,
        tokenHash: true,
        attempts: true,
        expiresAt: true,
        usedAt: true,
        user: {
          select: {
            id: true,
            role: true,
            authVersion: true,
            phoneVerifiedAt: true,
            emailVerifiedAt: true,
          },
        },
      },
    })

    if (!record || record.purpose !== AuthVerificationPurpose.EMAIL_VERIFY) {
      return jsonFail(400, 'Invalid verification token.', {
        code: 'TOKEN_INVALID',
      })
    }

    userIdForLog = record.userId
    emailForLog = record.email

    if (record.usedAt) {
      return jsonFail(400, 'This verification link has already been used.', {
        code: 'TOKEN_USED',
      })
    }

    if (record.expiresAt <= now) {
      await prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      })

      return jsonFail(400, 'This verification link has expired.', {
        code: 'TOKEN_EXPIRED',
      })
    }

    const submittedTokenHash = sha256Hex(token)
    const isMatch = timingSafeEqualHex(submittedTokenHash, record.tokenHash)

    if (!isMatch) {
      const nextAttempts = record.attempts + 1
      const shouldLock = nextAttempts >= MAX_VERIFY_ATTEMPTS

      const updateResult = await prisma.emailVerificationToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          attempts: record.attempts,
        },
        data: shouldLock
          ? {
              attempts: { increment: 1 },
              usedAt: now,
            }
          : {
              attempts: { increment: 1 },
            },
      })

      if (shouldLock && updateResult.count > 0) {
        return jsonFail(
          429,
          'Too many incorrect verification attempts. Request a new verification email.',
          {
            code: 'TOKEN_LOCKED',
            resendRequired: true,
          },
        )
      }

      return jsonFail(400, 'Invalid verification token.', {
        code: 'TOKEN_INVALID',
      })
    }

    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.emailVerificationToken.update({
          where: { id: record.id },
          data: { usedAt: now },
        })

        await tx.emailVerificationToken.updateMany({
          where: {
            userId: record.userId,
            purpose: AuthVerificationPurpose.EMAIL_VERIFY,
            usedAt: null,
          },
          data: { usedAt: now },
        })

        const updatedUser = await tx.user.update({
          where: { id: record.userId },
          data: {
            emailVerifiedAt: record.user.emailVerifiedAt ?? now,
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

        return updatedUser
      },
    )

    const isPhoneVerified = Boolean(result.phoneVerifiedAt)
    const isEmailVerified = Boolean(result.emailVerifiedAt)
    const isFullyVerified = isPhoneVerified && isEmailVerified

    logAuthEvent({
      level: 'info',
      event: 'auth.email.verify.success',
      route: 'auth.email.verify',
      userId: result.id,
      email: result.email,
      verificationId: record.id,
      meta: {
        isPhoneVerified,
        isEmailVerified,
        isFullyVerified,
      },
    })

    const res = jsonOk(
      {
        ok: true,
        alreadyVerified: Boolean(record.user.emailVerifiedAt),
        isPhoneVerified,
        isEmailVerified,
        isFullyVerified,
        requiresPhoneVerification: !isPhoneVerified,
      },
      200,
    )

    const authenticatedUserId = await getAuthenticatedUserId()
    if (authenticatedUserId === result.id) {
      const sessionToken = isFullyVerified
        ? createActiveToken({
            userId: result.id,
            role: result.role,
            authVersion: result.authVersion,
          })
        : createVerificationToken({
            userId: result.id,
            role: result.role,
            authVersion: result.authVersion,
          })

      const hostname = getRequestHostname(request)
      const cookieDomain = resolveCookieDomain(hostname)
      const isHttps = resolveIsHttps(request)

      res.cookies.set('tovis_token', sessionToken, {
        httpOnly: true,
        secure: isHttps,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      })
    }

    return res
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.email.verify.failed',
      route: 'auth.email.verify',
      code: 'INTERNAL',
      verificationId: verificationIdForLog,
      userId: userIdForLog,
      email: emailForLog,
      error,
    })

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}