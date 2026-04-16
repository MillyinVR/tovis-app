import crypto from 'crypto'
import { AuthVerificationPurpose, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { logAuthEvent } from '@/lib/observability/authEvents'

const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email'

export const EMAIL_VERIFICATION_EXPIRY_MS = 1000 * 60 * 60 * 24 // 24 hours
export const EMAIL_VERIFICATION_COOLDOWN_SECONDS = 60
export const EMAIL_VERIFICATION_HOURLY_CAP = 5

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function generateEmailToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function envOrThrow(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }
  return value
}

function envOrNull(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function sanitizeInternalPath(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  return value
}

function sanitizeOptionalText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  return value || null
}

function appendIfPresent(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value) params.set(key, value)
}

export function getAppUrlFromRequest(request: Request): string | null {
  const envUrl = envOrNull('NEXT_PUBLIC_APP_URL')
  if (envUrl) {
    return envUrl.replace(/\/+$/, '')
  }

  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'

  if (!host) return null

  return `${proto}://${host}`.replace(/\/+$/, '')
}

export function buildVerifyEmailUrl(args: {
  appUrl: string
  verificationId: string
  token: string
  next?: string | null
  intent?: string | null
  inviteToken?: string | null
}): string {
  const url = new URL('/verify-email', args.appUrl)

  url.searchParams.set('verificationId', args.verificationId)
  url.searchParams.set('token', args.token)

  appendIfPresent(url.searchParams, 'next', sanitizeInternalPath(args.next))
  appendIfPresent(
    url.searchParams,
    'intent',
    sanitizeOptionalText(args.intent),
  )
  appendIfPresent(
    url.searchParams,
    'inviteToken',
    sanitizeOptionalText(args.inviteToken),
  )

  return url.toString()
}

export async function enforceEmailVerificationLimits(
  userId: string,
  tx?: Prisma.TransactionClient,
) {
  const db = getDb(tx)
  const now = Date.now()
  const oneMinuteAgo = new Date(
    now - EMAIL_VERIFICATION_COOLDOWN_SECONDS * 1000,
  )
  const oneHourAgo = new Date(now - 60 * 60 * 1000)

  const recent = await db.emailVerificationToken.findFirst({
    where: {
      userId,
      purpose: AuthVerificationPurpose.EMAIL_VERIFY,
      createdAt: { gte: oneMinuteAgo },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })

  if (recent) {
    return {
      ok: false as const,
      retryAfterSeconds: EMAIL_VERIFICATION_COOLDOWN_SECONDS,
    }
  }

  const hourlyCount = await db.emailVerificationToken.count({
    where: {
      userId,
      purpose: AuthVerificationPurpose.EMAIL_VERIFY,
      createdAt: { gte: oneHourAgo },
    },
  })

  if (hourlyCount >= EMAIL_VERIFICATION_HOURLY_CAP) {
    return { ok: false as const, retryAfterSeconds: 60 * 10 }
  }

  return { ok: true as const, retryAfterSeconds: 0 }
}

export async function createEmailVerificationToken(args: {
  userId: string
  email: string
  tx?: Prisma.TransactionClient
}) {
  const db = getDb(args.tx)
  const now = new Date()
  const token = generateEmailToken()
  const tokenHash = sha256(token)
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS)

  await db.emailVerificationToken.updateMany({
    where: {
      userId: args.userId,
      purpose: AuthVerificationPurpose.EMAIL_VERIFY,
      usedAt: null,
    },
    data: { usedAt: now },
  })

  const created = await db.emailVerificationToken.create({
    data: {
      userId: args.userId,
      purpose: AuthVerificationPurpose.EMAIL_VERIFY,
      email: args.email,
      tokenHash,
      expiresAt,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  })

  return {
    id: created.id,
    token,
    expiresAt: created.expiresAt,
  }
}

export async function markEmailVerificationTokenUsed(args: {
  id: string
  usedAt?: Date
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const db = getDb(args.tx)

  await db.emailVerificationToken.update({
    where: { id: args.id },
    data: { usedAt: args.usedAt ?? new Date() },
  })
}

export async function sendVerificationEmail(args: {
  to: string
  verifyUrl: string
}): Promise<void> {
  const apiToken = envOrThrow('POSTMARK_SERVER_TOKEN')
  const fromEmail = envOrThrow('POSTMARK_FROM_EMAIL')
  const messageStream = envOrNull('POSTMARK_MESSAGE_STREAM')

  const subject = 'Verify your email for TOVIS'
  const text = [
    'Verify your email to finish setting up your TOVIS account.',
    '',
    `Open this link: ${args.verifyUrl}`,
    '',
    'This link expires in 24 hours.',
    'If you did not create this account, you can ignore this email.',
  ].join('\n')

  const html = [
    '<p>Verify your email to finish setting up your TOVIS account.</p>',
    `<p><a href="${args.verifyUrl}">Verify your email</a></p>`,
    '<p>This link expires in 24 hours.</p>',
    '<p>If you did not create this account, you can ignore this email.</p>',
  ].join('')

  const payload = {
    From: fromEmail,
    To: args.to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    ...(messageStream ? { MessageStream: messageStream } : {}),
  }

  const response = await fetch(POSTMARK_SEND_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiToken,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  const rawText = await response.text()
  let parsed: unknown = null

  try {
    parsed = rawText ? JSON.parse(rawText) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const message =
      isRecord(parsed) && typeof parsed.Message === 'string'
        ? parsed.Message
        : rawText || `Postmark request failed with HTTP ${response.status}.`
    throw new Error(message)
  }

  if (
    isRecord(parsed) &&
    typeof parsed.ErrorCode === 'number' &&
    parsed.ErrorCode !== 0
  ) {
    const message =
      typeof parsed.Message === 'string'
        ? parsed.Message
        : 'Postmark rejected the verification email.'
    throw new Error(message)
  }
}

export async function issueAndSendEmailVerification(args: {
  userId: string
  email: string
  appUrl: string
  next?: string | null
  intent?: string | null
  inviteToken?: string | null
  tx?: Prisma.TransactionClient
}) {
  const issued = await createEmailVerificationToken({
    userId: args.userId,
    email: args.email,
    tx: args.tx,
  })

  const verifyUrl = buildVerifyEmailUrl({
    appUrl: args.appUrl,
    verificationId: issued.id,
    token: issued.token,
    next: args.next,
    intent: args.intent,
    inviteToken: args.inviteToken,
  })

  try {
    await sendVerificationEmail({
      to: args.email,
      verifyUrl,
    })
  } catch (error) {
    await markEmailVerificationTokenUsed({
      id: issued.id,
      usedAt: new Date(),
    })
    throw error
  }

  logAuthEvent({
    level: 'info',
    event: 'auth.email.send.success',
    route: 'auth.email.send',
    provider: 'postmark',
    userId: args.userId,
    email: args.email,
    verificationId: issued.id,
  })

  return {
    id: issued.id,
    expiresAt: issued.expiresAt,
  }
}