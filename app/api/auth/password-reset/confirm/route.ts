// app/api/auth/password-reset/confirm/route.ts

import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { hashPassword } from '@/lib/auth'
import {
  jsonFail,
  jsonOk,
  pickString,
  enforceRateLimit,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { validatePassword } from '@/lib/passwordPolicy'
import { captureAuthException } from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'

type Body = {
  token?: unknown
  password?: unknown
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export async function POST(req: Request) {
  let userIdForLog: string | null = null

  try {
    const identity = await rateLimitIdentity()
    const rlRes = await enforceRateLimit({
      bucket: 'auth:password-reset-confirm',
      identity,
    })
    if (rlRes) return rlRes

    const body = (await req.json().catch(() => ({}))) as Body

    const token = pickString(body.token)
    const password = pickString(body.password)

    if (!token || !password) {
      return jsonFail(400, 'Missing required fields.', {
        code: 'MISSING_FIELDS',
      })
    }

    const passwordErr = validatePassword(password)
    if (passwordErr) {
      return jsonFail(400, passwordErr, {
        code: 'WEAK_PASSWORD',
      })
    }

    const tokenHash = sha256(token)

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    })

    if (!record) {
      return jsonFail(400, 'This reset link is invalid or has expired.', {
        code: 'INVALID_TOKEN',
      })
    }

    userIdForLog = record.userId

    if (record.usedAt) {
      return jsonFail(400, 'This reset link has already been used.', {
        code: 'TOKEN_USED',
      })
    }

    if (record.expiresAt.getTime() < Date.now()) {
      return jsonFail(400, 'This reset link is invalid or has expired.', {
        code: 'TOKEN_EXPIRED',
      })
    }

    const passwordHash = await hashPassword(password)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: {
          password: passwordHash,
          authVersion: { increment: 1 },
        },
        select: { id: true },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
        select: { id: true },
      }),
    ])

    return jsonOk({ ok: true }, 200)
  } catch (err: unknown) {
    captureAuthException({
      event: 'auth.password_reset.confirm.failed',
      route: 'auth.passwordReset.confirm',
      code: 'INTERNAL',
      userId: userIdForLog,
      error: err,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}