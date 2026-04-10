import crypto from 'crypto'
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email'

export const PASSWORD_RESET_EXPIRY_MS = 1000 * 60 * 30 // 30 minutes

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function generateResetToken(): string {
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

export function getPasswordResetAppUrlFromRequest(request: Request): string | null {
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

export function buildPasswordResetUrl(args: {
  appUrl: string
  token: string
}): string {
  const url = new URL(`/reset-password/${args.token}`, args.appUrl)
  return url.toString()
}

export function getPasswordResetRequestIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (!xff) return null

  const first = xff.split(',')[0]?.trim()
  return first || null
}

export async function createPasswordResetToken(args: {
  userId: string
  ip?: string | null
  userAgent?: string | null
  tx?: Prisma.TransactionClient
}) {
  const db = getDb(args.tx)
  const now = new Date()
  const token = generateResetToken()
  const tokenHash = sha256(token)
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS)

  await db.passwordResetToken.updateMany({
    where: {
      userId: args.userId,
      usedAt: null,
    },
    data: { usedAt: now },
  })

  const created = await db.passwordResetToken.create({
    data: {
      userId: args.userId,
      tokenHash,
      expiresAt,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
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

export async function markPasswordResetTokenUsed(args: {
  id: string
  usedAt?: Date
  tx?: Prisma.TransactionClient
}): Promise<void> {
  const db = getDb(args.tx)

  await db.passwordResetToken.update({
    where: { id: args.id },
    data: { usedAt: args.usedAt ?? new Date() },
  })
}

export async function sendPasswordResetEmail(args: {
  to: string
  resetUrl: string
}): Promise<void> {
  const apiToken = envOrThrow('POSTMARK_SERVER_TOKEN')
  const fromEmail = envOrThrow('POSTMARK_FROM_EMAIL')
  const messageStream = envOrNull('POSTMARK_MESSAGE_STREAM')

  const subject = 'Reset your TOVIS password'
  const text = [
    'We received a request to reset your TOVIS password.',
    '',
    `Open this link: ${args.resetUrl}`,
    '',
    'This link expires in 30 minutes.',
    'If you did not request this, you can ignore this email.',
  ].join('\n')

  const html = [
    '<p>We received a request to reset your TOVIS password.</p>',
    `<p><a href="${args.resetUrl}">Reset your password</a></p>`,
    '<p>This link expires in 30 minutes.</p>',
    '<p>If you did not request this, you can ignore this email.</p>',
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
        : 'Postmark rejected the password reset email.'
    throw new Error(message)
  }
}

export async function issueAndSendPasswordReset(args: {
  userId: string
  email: string
  appUrl: string
  ip?: string | null
  userAgent?: string | null
  tx?: Prisma.TransactionClient
}) {
  const issued = await createPasswordResetToken({
    userId: args.userId,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    tx: args.tx,
  })

  const resetUrl = buildPasswordResetUrl({
    appUrl: args.appUrl,
    token: issued.token,
  })

  try {
    await sendPasswordResetEmail({
      to: args.email,
      resetUrl,
    })
  } catch (error) {
    await markPasswordResetTokenUsed({
      id: issued.id,
      usedAt: new Date(),
    })
    throw error
  }

  return {
    id: issued.id,
    expiresAt: issued.expiresAt,
  }
}