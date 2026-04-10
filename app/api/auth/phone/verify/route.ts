// app/api/auth/phone/verify/route.ts
import crypto from 'crypto'

import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export async function POST(request: Request) {
  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const userId = auth.user.id

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
    if (!phone) {
      return jsonFail(400, 'Phone number missing.', {
        code: 'PHONE_REQUIRED',
      })
    }

    const now = new Date()
    const codeHash = sha256(codeRaw)

    const match = await prisma.phoneVerification.findFirst({
      where: {
        userId,
        phone,
        usedAt: null,
        expiresAt: { gt: now },
        codeHash,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!match) {
      return jsonFail(400, 'Incorrect or expired code.', {
        code: 'CODE_MISMATCH',
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.phoneVerification.update({
        where: { id: match.id },
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

    return jsonOk(
      {
        ok: true,
        isPhoneVerified: true,
        isEmailVerified,
        isFullyVerified: isEmailVerified,
        requiresEmailVerification: !isEmailVerified,
      },
      200,
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[phone/verify] error', message)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}