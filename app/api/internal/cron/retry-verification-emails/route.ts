// app/api/internal/cron/retry-verification-emails/route.ts
import { AuthVerificationPurpose } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { getInternalJobSecret, isAuthorizedJobRequest } from '@/app/api/_utils/auth/internalJob'
import {
  getAppUrlFromRequest,
  isInactiveRecipientError,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import { rootTenantContext } from '@/lib/tenant/context'
import { getRootTenantId } from '@/lib/tenant/resolveTenant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_TAKE = 50
const MAX_TAKE = 50
const RETRY_DELAY_MS = 5 * 60 * 1000
const ROUTE = 'internal.cron.retry_verification_emails'

type RetryVerificationFailure = {
  userId: string
  code: 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SEND_FAILED' | 'EMAIL_RECIPIENT_INACTIVE'
}

function readTake(req: Request): number {
  const url = new URL(req.url)
  const raw = url.searchParams.get('take')
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TAKE

  if (!Number.isFinite(parsed)) return DEFAULT_TAKE
  return Math.max(1, Math.min(MAX_TAKE, parsed))
}

function classifyEmailError(error: unknown): RetryVerificationFailure['code'] {
  if (isInactiveRecipientError(error)) return 'EMAIL_RECIPIENT_INACTIVE'

  const message = error instanceof Error ? error.message : ''
  return message.includes('Missing env var: POSTMARK_')
    ? 'EMAIL_NOT_CONFIGURED'
    : 'EMAIL_SEND_FAILED'
}

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
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

  // Cron has no tenant host; retried signup verifications send root-brand
  // copy until users carry a home tenant (WS-9).
  const tenantContext = rootTenantContext(await getRootTenantId())

  const candidates = await prisma.user.findMany({
    where: {
      emailVerifiedAt: null,
      emailSendPermanentlyFailedAt: null,
      createdAt: {
        lte: olderThan,
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
  let permanentlyFailedCount = 0

  const failed: RetryVerificationFailure[] = []

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
        tenantContext,
      })

      sentCount += 1

      logAuthEvent({
        level: 'info',
        event: 'auth.email.retry_verification.sent',
        route: ROUTE,
        provider: 'postmark',
        userId: candidate.id,
      })
    } catch (error: unknown) {
      failedCount += 1

      const code = classifyEmailError(error)

      failed.push({
        userId: candidate.id,
        code,
      })

      captureAuthException({
        event: 'auth.email.retry_verification.failed',
        route: ROUTE,
        provider: 'postmark',
        code,
        userId: candidate.id,
        error,
      })

      if (code === 'EMAIL_RECIPIENT_INACTIVE') {
        try {
          await prisma.user.update({
            where: { id: candidate.id },
            data: { emailSendPermanentlyFailedAt: now },
          })

          permanentlyFailedCount += 1

          logAuthEvent({
            level: 'warn',
            event: 'auth.email.retry_verification.permanently_failed',
            route: ROUTE,
            provider: 'postmark',
            code,
            userId: candidate.id,
          })
        } catch (markError: unknown) {
          captureAuthException({
            event: 'auth.email.retry_verification.mark_permanent_failed',
            route: ROUTE,
            provider: 'postmark',
            code,
            userId: candidate.id,
            error: markError,
          })
        }
      }
    }
  }

  return jsonOk({
    scannedCount: candidates.length,
    attemptedCount,
    sentCount,
    failedCount,
    skippedCount,
    permanentlyFailedCount,
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
    return jsonFail(500, 'Internal server error')
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
    return jsonFail(500, 'Internal server error')
  }
}