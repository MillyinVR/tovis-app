// app/api/_utils/auth/internalJob.ts
import { timingSafeEqualUtf8 } from '@/lib/auth/timingSafe'
import { readOptionalEnv as readEnv } from '@/lib/env'

/**
 * Shared secret used to authorize internal job / cron route invocations.
 * INTERNAL_JOB_SECRET takes precedence, falling back to CRON_SECRET.
 */
export function getInternalJobSecret(): string | null {
  return readEnv('INTERNAL_JOB_SECRET') ?? readEnv('CRON_SECRET')
}

/**
 * Authorize an internal job/cron request. Accepts either an
 * `Authorization: Bearer <secret>` header or an `x-internal-job-secret: <secret>`
 * header, compared in constant time. Returns false when no secret is configured.
 */
export function isAuthorizedJobRequest(req: Request): boolean {
  const secret = getInternalJobSecret()
  if (!secret) return false

  const authHeader = req.headers.get('authorization')
  if (authHeader && timingSafeEqualUtf8(authHeader, `Bearer ${secret}`)) {
    return true
  }

  const internalHeader = req.headers.get('x-internal-job-secret')
  if (internalHeader && timingSafeEqualUtf8(internalHeader, secret)) {
    return true
  }

  return false
}
