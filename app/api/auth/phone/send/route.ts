// app/api/auth/phone/send/route.ts
import crypto from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'
import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function generateSmsCode() {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, '0')
}

async function getUserIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value
  if (!token) return null
  const payload = verifyToken(token)
  return payload?.userId ?? null
}

function envOrThrow(key: string) {
  const v = process.env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

async function sendTwilioSms(args: { to: string; body: string }) {
  const sid = envOrThrow('TWILIO_ACCOUNT_SID')
  const auth = envOrThrow('TWILIO_AUTH_TOKEN')
  const from = envOrThrow('TWILIO_FROM_NUMBER')

  const credentials = Buffer.from(`${sid}:${auth}`).toString('base64')

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const form = new URLSearchParams()
  form.set('To', args.to)
  form.set('From', from)
  form.set('Body', args.body)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = typeof data?.message === 'string' ? data.message : 'SMS send failed.'
    throw new Error(msg)
  }

  return data
}

/**
 * Rate limits:
 * - Cooldown: 60s between sends
 * - Hourly cap: 5 per hour per user
 */
async function enforceOtpLimits(userId: string) {
  const now = Date.now()
  const oneMinuteAgo = new Date(now - 60 * 1000)
  const oneHourAgo = new Date(now - 60 * 60 * 1000)

  const recent = await prisma.phoneVerification.findFirst({
    where: { userId, createdAt: { gte: oneMinuteAgo } },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })

  if (recent) return { ok: false as const, retryAfterSeconds: 60 }

  const hourlyCount = await prisma.phoneVerification.count({
    where: { userId, createdAt: { gte: oneHourAgo } },
  })

  if (hourlyCount >= 5) return { ok: false as const, retryAfterSeconds: 60 * 10 }

  return { ok: true as const, retryAfterSeconds: 0 }
}

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromCookie()
    if (!userId) return jsonFail(401, 'Not authenticated.', { code: 'UNAUTHENTICATED' })

    const body = (await request.json().catch(() => ({}))) as { phone?: unknown }
    const phoneOverride = pickString(body.phone)

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, phoneVerifiedAt: true },
    })

    if (!user) return jsonFail(404, 'User not found.', { code: 'USER_NOT_FOUND' })
    if (user.phoneVerifiedAt) return jsonOk({ ok: true, alreadyVerified: true }, 200)

    const phone = (phoneOverride || user.phone || '').trim()
    if (!phone) return jsonFail(400, 'Phone number missing.', { code: 'PHONE_REQUIRED' })

    const limit = await enforceOtpLimits(userId)
    if (!limit.ok) {
      const res = jsonFail(429, 'Too many requests. Try again shortly.', {
        code: 'RATE_LIMITED',
        retryAfterSeconds: limit.retryAfterSeconds,
      })
      res.headers.set('Retry-After', String(limit.retryAfterSeconds))
      return res
    }

    const code = generateSmsCode()
    const codeHash = sha256(code)
    const expiresAt = new Date(Date.now() + 1000 * 60 * 10) // 10 minutes

    await prisma.$transaction(async (tx) => {
      await tx.phoneVerification.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      })

      await tx.phoneVerification.create({
        data: { userId, phone, codeHash, expiresAt },
      })
    })

    await sendTwilioSms({
      to: phone,
      body: `TOVIS: Your verification code is ${code}. Expires in 10 minutes.`,
    })

    return jsonOk({ ok: true }, 200)
  } catch (err) {
    console.error('[phone/send] error', err)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
