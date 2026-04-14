// app/api/auth/phone/send/route.ts
import crypto from 'crypto'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/http'
import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function generateSmsCode() {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, '0')
}

function envOrThrow(key: string) {
  const v = process.env[key]
  if (!v) throw new Error(`Missing env var: ${key}`)
  return v
}

function readPhoneSendErrorCode(err: unknown): 'SMS_NOT_CONFIGURED' | 'SMS_SEND_FAILED' | 'INTERNAL' {
  const msg = err instanceof Error ? err.message : ''

  if (msg.includes('Missing env var: TWILIO_')) {
    return 'SMS_NOT_CONFIGURED'
  }

  if (msg) {
    return 'SMS_SEND_FAILED'
  }

  return 'INTERNAL'
}

async function sendTwilioSms(args: { to: string; body: string }): Promise<{ sid: string | null }> {
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

  const data: unknown = await safeJson(res)

  if (!res.ok) {
    const msg = isRecord(data) && typeof data.message === 'string' ? data.message : 'SMS send failed.'
    const code =
      isRecord(data) && (typeof data.code === 'number' || typeof data.code === 'string')
        ? ` (Twilio code ${String(data.code)})`
        : ''
    const status =
      isRecord(data) && (typeof data.status === 'number' || typeof data.status === 'string')
        ? ` status=${String(data.status)}`
        : ` status=${res.status}`

    throw new Error(`${msg}${code}${status}`)
  }

  const twilioSid = isRecord(data) && typeof data.sid === 'string' ? data.sid : null
  return { sid: twilioSid }
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

export async function POST(_request: Request) {
  try {
    const auth = await requireUser({ allowVerificationSession: true })
    if (!auth.ok) return auth.res

    const userId = auth.user.id

    if (auth.user.phoneVerifiedAt) {
      return jsonOk({ alreadyVerified: true, sent: false }, 200)
    }

    const phone = (auth.user.phone ?? '').trim()
    if (!phone) {
      return jsonFail(400, 'Phone number missing.', { code: 'PHONE_REQUIRED' })
    }

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
    const expiresAt = new Date(Date.now() + 1000 * 60 * 10)

    // Save the code to the DB before sending so the user can always verify it.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.phoneVerification.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      })

      await tx.phoneVerification.create({
        data: { userId, phone, codeHash, expiresAt },
      })
    })

    const twilio = await sendTwilioSms({
      to: phone,
      body: `TOVIS: Your verification code is ${code}. Expires in 10 minutes.`,
    })

    if (process.env.NODE_ENV !== 'production') {
      console.log('[phone/send] sent', { to: phone, sid: twilio.sid })
    } else {
      console.log('[phone/send] sent', { sid: twilio.sid })
    }

    return jsonOk({ sent: true }, 200)
  } catch (err: unknown) {
    const code = readPhoneSendErrorCode(err)

    if (code === 'SMS_NOT_CONFIGURED') {
      console.error('[phone/send] twilio env missing', err)
      return jsonFail(500, 'SMS provider is not configured.', { code })
    }

    if (code === 'SMS_SEND_FAILED') {
      console.error('[phone/send] send failed', err)
      return jsonFail(502, 'Could not send verification code. Please try again.', { code })
    }

    console.error('[phone/send] error', err)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
