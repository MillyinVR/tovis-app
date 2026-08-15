// app/api/v1/auth/email/verify/route.ts
import { AuthVerificationPurpose, Prisma } from '@prisma/client'

import { createActiveToken, createVerificationToken } from '@/lib/auth'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import type { AuthEmailVerifyResponseDTO } from '@/lib/dto/auth'
import { enforceVerificationVerifyThrottle } from '@/app/api/_utils/auth/verificationThrottle'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { sha256Hex, timingSafeEqualHex } from '@/lib/auth/timingSafe'
import { getOptionalUser } from '@/app/api/_utils/auth/getOptionalUser'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import {
  logAuthEvent,
  captureAuthException,
} from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_VERIFY_ATTEMPTS = 5

async function readVerificationBody(request: Request): Promise<{
  verificationId: string | null
  token: string | null
}> {
  const body = await readJsonRecord(request)

  const verificationId = pickString(body.verificationId)?.trim() ?? null
  const token = pickString(body.token)?.trim() ?? null

  return {
    verificationId:
      verificationId && verificationId.length > 0 ? verificationId : null,
    token: token && token.length > 0 ? token : null,
  }
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

    // Only re-mint a session when the verifying caller IS the account owner
    // (email verify can be driven from a magic link by an unauthenticated
    // browser). When it is, native needs the upgraded token in the body.
    const currentUser = await getOptionalUser()
    const sessionToken =
      currentUser?.id === result.id
        ? isFullyVerified
          ? createActiveToken({
              userId: result.id,
              role: result.role,
              authVersion: result.authVersion,
              deviceId: currentUser.deviceId, // preserve device binding
            })
          : createVerificationToken({
              userId: result.id,
              role: result.role,
              authVersion: result.authVersion,
              deviceId: currentUser.deviceId,
            })
        : null

    const res = jsonOk(
      {
        ok: true,
        alreadyVerified: Boolean(record.user.emailVerifiedAt),
        isPhoneVerified,
        isEmailVerified,
        isFullyVerified,
        requiresPhoneVerification: !isPhoneVerified,
        // Native replays this as a bearer; web uses the cookie set below.
        // Null when the caller is not the verified account owner.
        token: sessionToken,
      } satisfies AuthEmailVerifyResponseDTO,
      200,
    )

    if (sessionToken) {
      setSessionCookie({ response: res, request, token: sessionToken })
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