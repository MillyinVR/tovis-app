// app/api/v1/auth/phone/verify/route.ts

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import type { AuthPhoneVerifyResponseDTO } from '@/lib/dto/auth'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { enforceVerificationVerifyThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { createActiveToken, createVerificationToken } from '@/lib/auth'
import { checkTwilioVerifyPhoneCode } from '@/lib/twilio/verify'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

function getRequestHostname(request: Request): string | null {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')

  return hostToHostname(host)
}

function normalizeVerificationCode(value: unknown): string | null {
  const code = pickString(value)?.trim()
  if (!code) return null
  return code
}

function isSixDigitCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

type CookieWritableResponse = ReturnType<typeof jsonOk>

function setSessionCookie(args: {
  response: CookieWritableResponse
  request: Request
  token: string
}): void {
  const hostname = getRequestHostname(args.request)
  const cookieDomain = resolveCookieDomain(hostname)
  const isHttps = resolveIsHttps(args.request)

  args.response.cookies.set('tovis_token', args.token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  })
}

export async function POST(request: Request) {
  let userIdForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const user = auth.user
    const userId = user.id

    userIdForLog = userId

    const body = await readJsonRecord(request)

    const code = normalizeVerificationCode(body.code)

    if (!code) {
      return jsonFail(400, 'Verification code is required.', {
        code: 'CODE_REQUIRED',
      })
    }

    if (!isSixDigitCode(code)) {
      return jsonFail(400, 'Invalid code format.', {
        code: 'CODE_INVALID',
      })
    }

    const phone = user.phone?.trim() ?? ''
    phoneForLog = phone || null

    if (!phone) {
      return jsonFail(400, 'Phone number missing.', {
        code: 'PHONE_REQUIRED',
      })
    }

    if (user.phoneVerifiedAt) {
      return jsonOk(
        {
          ok: true,
          alreadyVerified: true,
          isPhoneVerified: true,
          isEmailVerified: user.isEmailVerified,
          isFullyVerified: user.isFullyVerified,
          requiresEmailVerification: !user.isEmailVerified,
          // No new token is minted on the already-verified path; native keeps
          // its current bearer.
          token: null,
        } satisfies AuthPhoneVerifyResponseDTO,
        200,
      )
    }

    const throttleRes = await enforceVerificationVerifyThrottle({
      request,
      scope: 'phone-verify',
      subjectKey: userId,
    })

    if (throttleRes) return throttleRes

    const verifyResult = await checkTwilioVerifyPhoneCode({
      to: phone,
      code,
    })

    if (!verifyResult.ok) {
      logAuthEvent({
        level:
          verifyResult.code === 'TWILIO_VERIFY_NOT_CONFIGURED'
            ? 'error'
            : 'warn',
        event: 'auth.phone.verify.twilio_check_failed',
        route: 'auth.phone.verify',
        provider: 'twilio_verify',
        code: verifyResult.code,
        userId,
        phone,
        meta: {
          message: verifyResult.message,
        },
      })

      const status =
        verifyResult.code === 'TWILIO_VERIFY_NOT_CONFIGURED' ? 503 : 502

      return jsonFail(status, 'Phone verification is unavailable.', {
        code: verifyResult.code,
      })
    }

    if (!verifyResult.approved) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.phone.verify.code_rejected',
        route: 'auth.phone.verify',
        provider: 'twilio_verify',
        userId,
        phone,
        meta: {
          sid: verifyResult.sid,
          status: verifyResult.status,
        },
      })

      return jsonFail(400, 'Incorrect or expired code.', {
        code: 'CODE_MISMATCH',
      })
    }

    const verifiedAt = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          phoneVerifiedAt: verifiedAt,
        },
      })

      if (user.role === 'CLIENT') {
        await tx.clientProfile.updateMany({
          where: { userId },
          data: {
            phoneVerifiedAt: verifiedAt,
          },
        })
      }

      if (user.role === 'PRO') {
        await tx.professionalProfile.updateMany({
          where: { userId },
          data: {
            phoneVerifiedAt: verifiedAt,
          },
        })
      }
    })

    const isEmailVerified = user.isEmailVerified
    const isFullyVerified = isEmailVerified

    logAuthEvent({
      level: 'info',
      event: 'auth.phone.verify.success',
      route: 'auth.phone.verify',
      provider: 'twilio_verify',
      userId,
      phone,
      meta: {
        sid: verifyResult.sid,
        status: verifyResult.status,
        isEmailVerified,
        isFullyVerified,
      },
    })

    const sessionToken = isFullyVerified
      ? createActiveToken({
          userId,
          role: user.role,
          authVersion: user.authVersion,
          deviceId: user.deviceId, // preserve device binding through verification
        })
      : createVerificationToken({
          userId,
          role: user.role,
          authVersion: user.authVersion,
          deviceId: user.deviceId,
        })

    const response = jsonOk(
      {
        ok: true,
        isPhoneVerified: true,
        isEmailVerified,
        isFullyVerified,
        requiresEmailVerification: !isEmailVerified,
        // Native replays this as a bearer; web uses the cookie set below. The
        // session kind upgrades here, so native must swap to this token.
        token: sessionToken,
      } satisfies AuthPhoneVerifyResponseDTO,
      200,
    )

    setSessionCookie({
      response,
      request,
      token: sessionToken,
    })

    return response
  } catch (error: unknown) {
    captureAuthException({
      event: 'auth.phone.verify.failed',
      route: 'auth.phone.verify',
      provider: 'twilio_verify',
      userId: userIdForLog,
      phone: phoneForLog,
      code: 'INTERNAL',
      error,
    })

    return jsonFail(500, 'Internal server error', {
      code: 'INTERNAL',
    })
  }
}