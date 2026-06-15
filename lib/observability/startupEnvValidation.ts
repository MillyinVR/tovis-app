// lib/observability/startupEnvValidation.ts
//
// Production startup env contract. Run once from instrumentation.register() on
// the Node runtime. FAIL-CLOSED: a production server booting without one of the
// required vars throws here, so the misconfiguration surfaces immediately at
// startup (loud 500s / crashed boot) instead of silently degrading and only
// failing later at request time (a missing cron secret 401s every cron; a
// missing Sentry DSN drops all error reporting; a missing Postmark config drops
// every email notification).
//
// Strictly gated on VERCEL_ENV === 'production' so preview, local dev, CI, and
// unit tests are never affected. Reuses the existing config readers so "present"
// means exactly what the consuming code requires.

import { readOptionalEnv } from '@/lib/env'
import { readPostmarkEmailConfig } from '@/lib/notifications/config'
import { readSentryDsn } from '@/lib/observability/sentryConfig'

type RequiredEnvCheck = {
  name: string
  isPresent: () => boolean
  hint: string
}

const REQUIRED_PRODUCTION_ENV: readonly RequiredEnvCheck[] = [
  {
    name: 'Sentry DSN',
    isPresent: () => Boolean(readSentryDsn()),
    hint: 'set SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN)',
  },
  {
    name: 'Internal job / cron secret',
    isPresent: () =>
      Boolean(
        readOptionalEnv('INTERNAL_JOB_SECRET') ?? readOptionalEnv('CRON_SECRET'),
      ),
    hint: 'set INTERNAL_JOB_SECRET (or CRON_SECRET)',
  },
  {
    name: 'Postmark email provider',
    isPresent: () => readPostmarkEmailConfig() !== null,
    hint: 'set POSTMARK_SERVER_TOKEN + POSTMARK_NOTIFICATION_FROM_EMAIL (or POSTMARK_FROM_EMAIL / EMAIL_FROM)',
  },
]

/**
 * True only on a Vercel production deployment. Preview deployments
 * (VERCEL_ENV=preview), local dev, and CI/tests (VERCEL_ENV unset) return false.
 */
export function isProductionRuntime(): boolean {
  return readOptionalEnv('VERCEL_ENV') === 'production'
}

/**
 * Names + hints for every required production env var that is currently missing.
 * Empty array when all are present (or when not running in production).
 */
export function collectMissingProductionEnv(): string[] {
  if (!isProductionRuntime()) return []

  return REQUIRED_PRODUCTION_ENV.filter((check) => !check.isPresent()).map(
    (check) => `${check.name} (${check.hint})`,
  )
}

/**
 * Throw when a production server is missing any required env var. No-op outside
 * production. Call once at startup (instrumentation.register).
 */
export function validateProductionStartupEnv(): void {
  const missing = collectMissingProductionEnv()
  if (missing.length === 0) return

  throw new Error(
    `Startup env validation failed in production — missing required configuration:\n` +
      missing.map((entry) => `  - ${entry}`).join('\n'),
  )
}
