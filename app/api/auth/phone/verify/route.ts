// app/api/auth/phone/verify/route.ts

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { enforceVerificationVerifyThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import { createActiveToken, createVerificationToken } from '@/lib/auth'
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
  let userIdForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const userId = auth.user.id
    userIdForLog = userId

    const raw: unknown = await request.json().catch(() => ({}))
    const body = isRecord(raw) ? raw : {}
    const codeRaw = pickString(body.code)?.trim()

    if (!codeRaw) {
      return jsonFail(400, 'Verification code is required.', {
        code: 'CODE_REQUIRED',
      })
    }

    if (!/^\d{6}$/.test(codeRaw)) {
      return jsonFail(400, 'Invalid code format.', {
        code: 'CODE_INVALID',
      })
    }

    if (auth.user.phoneVerifiedAt) {
      return jsonOk(
        {
          ok: true,
          alreadyVerified: true,
          isPhoneVerified: true,
          isEmailVerified: auth.user.isEmailVerified,
          isFullyVerified: auth.user.isFullyVerified,
        },
        200,
      )
    }

    const phone = auth.user.phone?.trim() ?? ''
    phoneForLog = phone || null

    if (!phone) {
      return jsonFail(400, 'Phone number missing.', {
        code: 'PHONE_REQUIRED',
      })
    }

    const throttleRes = await enforceVerificationVerifyThrottle({
      request,
      scope: 'phone-verify',
      subjectKey: userId,
    })
    if (throttleRes) return throttleRes

    const now = new Date()
    const submittedCodeHash = sha256Hex(codeRaw)

    const record = await prisma.phoneVerification.findFirst({
      where: {
        userId,
        phone,
        usedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        codeHash: true,
        attempts: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!record) {
      return jsonFail(400, 'Incorrect or expired code.', {
        code: 'CODE_MISMATCH',
      })
    }

    const isMatch = timingSafeEqualHex(submittedCodeHash, record.codeHash)

    if (!isMatch) {
      const nextAttempts = record.attempts + 1
      const shouldLock = nextAttempts >= MAX_VERIFY_ATTEMPTS

      const updateResult = await prisma.phoneVerification.updateMany({
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
          'Too many incorrect verification attempts. Request a new verification code.',
          {
            code: 'CODE_LOCKED',
            resendRequired: true,
          },
        )
      }

      return jsonFail(400, 'Incorrect or expired code.', {
        code: 'CODE_MISMATCH',
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.phoneVerification.update({
        where: { id: record.id },
        data: { usedAt: now },
      })

      await tx.user.update({
        where: { id: userId },
        data: { phoneVerifiedAt: now },
      })

      await tx.clientProfile.updateMany({
        where: { userId },
        data: { phoneVerifiedAt: now },
      })

      await tx.professionalProfile.updateMany({
        where: { userId },
        data: { phoneVerifiedAt: now },
      })
    })

    const isEmailVerified = auth.user.isEmailVerified
    const isFullyVerified = isEmailVerified

    logAuthEvent({
      level: 'info',
      event: 'auth.phone.verify.success',
      route: 'auth.phone.verify',
      userId,
      phone,
      meta: {
        isEmailVerified,
        isFullyVerified,
      },
    })

    const res = jsonOk(
      {
        ok: true,
        isPhoneVerified: true,
        isEmailVerified,
        isFullyVerified,
        requiresEmailVerification: !isEmailVerified,
      },
      200,
    )

    const sessionToken = isFullyVerified
      ? createActiveToken({
          userId,
          role: auth.user.role,
          authVersion: auth.user.authVersion,
        })
      : createVerificationToken({
          userId,
          role: auth.user.role,
          authVersion: auth.user.authVersion,
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

    return res
  } catch (err: unknown) {
    captureAuthException({
      event: 'auth.phone.verify.failed',
      route: 'auth.phone.verify',
      userId: userIdForLog,
      phone: phoneForLog,
      code: 'INTERNAL',
      error: err,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}