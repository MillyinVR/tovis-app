import crypto from 'crypto'
import { AuthVerificationPurpose, Prisma } from '@prisma/client'

import { readOptionalEnv as envOrNull } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { logAuthEvent } from '@/lib/observability/authEvents'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import type { TenantContext } from '@/lib/tenant/context'

const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email'

// Postmark API ErrorCode for recipients marked inactive/suppressed (hard
// bounce, spam complaint, or manual suppression). Retrying these never
// succeeds until the suppression is lifted on the Postmark side.
export const POSTMARK_INACTIVE_RECIPIENT_ERROR_CODE = 406

export class PostmarkSendError extends Error {
  readonly errorCode: number | null

  constructor(message: string, errorCode: number | null) {
    super(message)
    this.name = 'PostmarkSendError'
    this.errorCode = errorCode
  }
}

export function isInactiveRecipientError(error: unknown): boolean {
  return (
    error instanceof PostmarkSendError &&
    error.errorCode === POSTMARK_INACTIVE_RECIPIENT_ERROR_CODE
  )
}

export const EMAIL_VERIFICATION_EXPIRY_MS = 1000 * 60 * 60 * 24 // 24 hours

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

function envOrThrow(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }
  return value
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
  brandName: string
}): Promise<void> {
  const apiToken = envOrThrow('POSTMARK_SERVER_TOKEN')
  const fromEmail = envOrThrow('POSTMARK_FROM_EMAIL')
  const messageStream = envOrNull('POSTMARK_MESSAGE_STREAM')

  const subject = `Verify your email for ${args.brandName}`
  const text = [
    `Verify your email to finish setting up your ${args.brandName} account.`,
    '',
    `Open this link: ${args.verifyUrl}`,
    '',
    'This link expires in 24 hours.',
    'If you did not create this account, you can ignore this email.',
  ].join('\n')

  const html = [
    `<p>Verify your email to finish setting up your ${args.brandName} account.</p>`,
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

  const errorCode =
    isRecord(parsed) && typeof parsed.ErrorCode === 'number'
      ? parsed.ErrorCode
      : null

  if (!response.ok) {
    const message =
      isRecord(parsed) && typeof parsed.Message === 'string'
        ? parsed.Message
        : rawText || `Postmark request failed with HTTP ${response.status}.`
    throw new PostmarkSendError(message, errorCode)
  }

  if (errorCode !== null && errorCode !== 0) {
    const message =
      isRecord(parsed) && typeof parsed.Message === 'string'
        ? parsed.Message
        : 'Postmark rejected the verification email.'
    throw new PostmarkSendError(message, errorCode)
  }
}

export async function issueAndSendEmailVerification(args: {
  userId: string
  email: string
  appUrl: string
  tenantContext: TenantContext
  next?: string | null
  intent?: string | null
  inviteToken?: string | null
  tx?: Prisma.TransactionClient
}) {
  const brand = getBrandForTenantContext(args.tenantContext)
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
      brandName: brand.displayName,
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