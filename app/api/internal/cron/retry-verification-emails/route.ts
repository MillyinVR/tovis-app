// app/api/internal/cron/retry-verification-emails/route.ts
import { AuthVerificationPurpose } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_TAKE = 50
const MAX_TAKE = 50
const RETRY_DELAY_MS = 5 * 60 * 1000
const ROUTE = 'internal.cron.retry_verification_emails'

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function getJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}

function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${secret}`) return true

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader === secret) return true

  return false
}

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

function classifyEmailError(
  error: unknown,
): 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SEND_FAILED' {
  const message = error instanceof Error ? error.message : ''
  return message.includes('Missing env var: POSTMARK_')
    ? 'EMAIL_NOT_CONFIGURED'
    : 'EMAIL_SEND_FAILED'
}

async function runJob(req: Request) {
  const secret = getJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const appUrl = getAppUrlFromRequest(req)
  if (!appUrl) {
    return jsonFail(500, 'App URL is not configured.', {
      code: 'APP_URL_MISSING',
    })
  }

  const now = new Date()
  const olderThan = new Date(now.getTime() - RETRY_DELAY_MS)
  const take = readTake(req)

  const candidates = await prisma.user.findMany({
    where: {
      emailVerifiedAt: null,
      createdAt: {
        lte: olderThan,
      },
      email: {
        not: null,
      },
      emailVerificationTokens: {
        none: {
          purpose: AuthVerificationPurpose.EMAIL_VERIFY,
          usedAt: null,
          expiresAt: {
            gt: now,
          },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
    select: {
      id: true,
      email: true,
      createdAt: true,
    },
  })

  let attemptedCount = 0
  let sentCount = 0
  let failedCount = 0
  let skippedCount = 0

  const failed: Array<{ userId: string; error: string }> = []

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email)
    if (!email) {
      skippedCount += 1
      continue
    }

    attemptedCount += 1

    try {
      await issueAndSendEmailVerification({
        userId: candidate.id,
        email,
        appUrl,
      })

      sentCount += 1

      logAuthEvent({
        level: 'info',
        event: 'auth.email.retry_verification.sent',
        route: ROUTE,
        provider: 'postmark',
        userId: candidate.id,
        email,
      })
    } catch (error: unknown) {
      failedCount += 1

      const code = classifyEmailError(error)
      const message =
        error instanceof Error
          ? error.message
          : 'Could not send verification email.'

      failed.push({
        userId: candidate.id,
        error: message,
      })

      captureAuthException({
        event: 'auth.email.retry_verification.failed',
        route: ROUTE,
        provider: 'postmark',
        code,
        userId: candidate.id,
        email,
        error,
      })
    }
  }

  return jsonOk({
    scannedCount: candidates.length,
    attemptedCount,
    sentCount,
    failedCount,
    skippedCount,
    take,
    processedAt: now.toISOString(),
    failed,
  })
}

export async function GET(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error('GET /api/internal/cron/retry-verification-emails error', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}

export async function POST(req: Request) {
  try {
    return await runJob(req)
  } catch (err: unknown) {
    console.error(
      'POST /api/internal/cron/retry-verification-emails error',
      err,
    )
    const message = err instanceof Error ? err.message : 'Internal server error'
    return jsonFail(500, message)
  }
}