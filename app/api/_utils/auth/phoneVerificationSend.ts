// app/api/_utils/auth/phoneVerificationSend.ts
import crypto from 'crypto'
import { Prisma } from '@prisma/client'

import { safeJson } from '@/lib/http'
import { prisma } from '@/lib/prisma'

export const PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60
export const PHONE_VERIFICATION_HOURLY_CAP = 5
export const PHONE_VERIFICATION_EXPIRY_MS = 1000 * 60 * 10

type DbClient = Prisma.TransactionClient | typeof prisma

export type PhoneSendErrorCode =
  | 'SMS_NOT_CONFIGURED'
  | 'SMS_SEND_FAILED'
  | 'INTERNAL'

export type PhoneVerificationOtpLimitResult =
  | { ok: true; retryAfterSeconds: 0 }
  | { ok: false; retryAfterSeconds: number }

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function generateSmsCode(): string {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, '0')
}

function envOrThrow(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing env var: ${key}`)
  }
  return value
}

export function readPhoneSendErrorCode(err: unknown): PhoneSendErrorCode {
  const message = err instanceof Error ? err.message : ''

  if (message.includes('Missing env var: TWILIO_')) {
    return 'SMS_NOT_CONFIGURED'
  }

  if (message) {
    return 'SMS_SEND_FAILED'
  }

  return 'INTERNAL'
}

async function sendTwilioSms(args: {
  to: string
  body: string
}): Promise<{ sid: string | null }> {
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
    const message =
      isRecord(data) && typeof data.message === 'string'
        ? data.message
        : 'SMS send failed.'

    const code =
      isRecord(data) &&
      (typeof data.code === 'number' || typeof data.code === 'string')
        ? ` (Twilio code ${String(data.code)})`
        : ''

    const status =
      isRecord(data) &&
      (typeof data.status === 'number' || typeof data.status === 'string')
        ? ` status=${String(data.status)}`
        : ` status=${res.status}`

    throw new Error(`${message}${code}${status}`)
  }

  const twilioSid =
    isRecord(data) && typeof data.sid === 'string' ? data.sid : null

  return { sid: twilioSid }
}

export async function enforcePhoneVerificationOtpLimits(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<PhoneVerificationOtpLimitResult> {
  const db = getDb(tx)

  const now = Date.now()
  const oneMinuteAgo = new Date(
    now - PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000,
  )
  const oneHourAgo = new Date(now - 60 * 60 * 1000)

  const recent = await db.phoneVerification.findFirst({
    where: {
      userId,
      createdAt: { gte: oneMinuteAgo },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })

  if (recent) {
    return {
      ok: false,
      retryAfterSeconds: PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    }
  }

  const hourlyCount = await db.phoneVerification.count({
    where: {
      userId,
      createdAt: { gte: oneHourAgo },
    },
  })

  if (hourlyCount >= PHONE_VERIFICATION_HOURLY_CAP) {
    return {
      ok: false,
      retryAfterSeconds: 60 * 10,
    }
  }

  return {
    ok: true,
    retryAfterSeconds: 0,
  }
}

async function storeFreshPhoneVerificationCode(args: {
  userId: string
  phone: string
  codeHash: string
  expiresAt: Date
}): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.phoneVerification.updateMany({
      where: {
        userId: args.userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    })

    await tx.phoneVerification.create({
      data: {
        userId: args.userId,
        phone: args.phone,
        codeHash: args.codeHash,
        expiresAt: args.expiresAt,
      },
    })
  })
}

export async function issueAndSendPhoneVerificationCode(args: {
  userId: string
  phone: string
  logTag?: string
}): Promise<{ sid: string | null }> {
  const logTag = args.logTag ?? '[phone/send]'

  const code = generateSmsCode()
  const codeHash = sha256(code)
  const expiresAt = new Date(Date.now() + PHONE_VERIFICATION_EXPIRY_MS)

  // Save the code before sending so the user can still verify against the
  // freshest code even if the SMS provider call fails.
  await storeFreshPhoneVerificationCode({
    userId: args.userId,
    phone: args.phone,
    codeHash,
    expiresAt,
  })

  const twilio = await sendTwilioSms({
    to: args.phone,
    body: `TOVIS: Your verification code is ${code}. Expires in 10 minutes.`,
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log(`${logTag} sent`, { to: args.phone, sid: twilio.sid })
  } else {
    console.log(`${logTag} sent`, { sid: twilio.sid })
  }

  return { sid: twilio.sid }
}