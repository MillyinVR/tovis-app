// app/api/auth/phone/verify/route.ts
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

async function getUserIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value
  if (!token) return null
  const payload = verifyToken(token)
  return payload?.userId ?? null
}

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromCookie()
    if (!userId) return jsonFail(401, 'Not authenticated.', { code: 'UNAUTHENTICATED' })

    const body = (await request.json().catch(() => ({}))) as { code?: unknown }
    const codeRaw = pickString(body.code)?.trim()

    if (!codeRaw) return jsonFail(400, 'Verification code is required.', { code: 'CODE_REQUIRED' })
    if (!/^\d{6}$/.test(codeRaw)) return jsonFail(400, 'Invalid code format.', { code: 'CODE_INVALID' })

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, phone: true, phoneVerifiedAt: true },
    })
    if (!user) return jsonFail(404, 'User not found.', { code: 'USER_NOT_FOUND' })

    if (user.phoneVerifiedAt) return jsonOk({ ok: true, alreadyVerified: true }, 200)
    if (!user.phone) return jsonFail(400, 'Phone number missing.', { code: 'PHONE_REQUIRED' })

    const now = new Date()
    const codeHash = sha256(codeRaw)

    const match = await prisma.phoneVerification.findFirst({
      where: {
        userId,
        phone: user.phone,
        usedAt: null,
        expiresAt: { gt: now },
        codeHash,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })

    if (!match) {
      return jsonFail(400, 'Incorrect or expired code.', { code: 'CODE_MISMATCH' })
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

      if (user.role === 'CLIENT') {
        await tx.clientProfile.updateMany({
          where: { userId },
          data: { phoneVerifiedAt: now },
        })
      }

      if (user.role === 'PRO') {
        await tx.professionalProfile.updateMany({
          where: { userId },
          data: { phoneVerifiedAt: now },
        })
      }
    })

    return jsonOk({ ok: true }, 200)
  } catch (err) {
    console.error('[phone/verify] error', err)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
