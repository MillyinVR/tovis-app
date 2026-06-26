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
import { isAeadKeyringValid } from '@/lib/security/crypto/aead'

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
  {
    // Read lazily by the AEAD layer (first PII op), so a dropped/mangled keyring
    // would otherwise boot green + pass smoke and only throw on the first
    // allergy/notes/phone read — a subsystem silently going dark post-deploy.
    name: 'PII encryption keyring',
    isPresent: () => isAeadKeyringValid(),
    hint: 'set PII_AEAD_KEYS_JSON to a JSON object of base64 32-byte keys',
  },
  {
    name: 'Database URL',
    isPresent: () => Boolean(readOptionalEnv('DATABASE_URL')),
    hint: 'set DATABASE_URL (pooled Postgres connection)',
  },
  {
    // Without it, getTrustedClientIpFromRequest returns null and every IP-keyed
    // rate limiter silently collapses to one shared `ip:'unknown'` bucket —
    // brute-force/enumeration guards (login, consultation/account-invite mint)
    // stop discriminating between callers. Fail-closed at boot so the gap is
    // never live in production.
    name: 'Trusted client IP header',
    isPresent: () => Boolean(readOptionalEnv('AUTH_TRUSTED_IP_HEADER')),
    hint: 'set AUTH_TRUSTED_IP_HEADER to the platform-trusted edge header (e.g. x-vercel-forwarded-for)',
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
 * Vercel scheduled (cron) invocations authenticate with `CRON_SECRET`, but the
 * job-auth guard prefers `INTERNAL_JOB_SECRET` when set. If both are set and
 * DIFFER, every cron 401s silently — the whole drift-healing layer (Stripe
 * reconciliation/requeue/orphan-recovery, notification drain, hold cleanup) goes
 * dark with no error. Warn loudly so the misconfig is visible. Not fail-closed:
 * either secret alone is valid, so this is a divergence footgun, not a missing
 * requirement.
 */
export function warnOnDivergentCronSecrets(): void {
  if (!isProductionRuntime()) return

  const internal = readOptionalEnv('INTERNAL_JOB_SECRET')
  const cron = readOptionalEnv('CRON_SECRET')

  if (internal && cron && internal !== cron) {
    console.error(
      JSON.stringify({
        level: 'error',
        app: 'tovis',
        namespace: 'startup',
        event: 'divergent_cron_secrets',
        message:
          'INTERNAL_JOB_SECRET and CRON_SECRET are both set but differ. The job guard prefers INTERNAL_JOB_SECRET, but Vercel cron sends CRON_SECRET — every scheduled job will 401. Set them to the same value (or unset INTERNAL_JOB_SECRET).',
      }),
    )
  }
}

/**
 * Connection-pooling footguns that degrade prod silently rather than failing a
 * boot. Warnings (not fail-closed) because either condition still boots:
 *
 *  1. Pooled DATABASE_URL with no `connection_limit`. On Vercel every serverless
 *     instance opens its own Prisma pool sized to `num_cpus*2+1` by default;
 *     under fan-out that overruns the Postgres/pooler max connections and reads
 *     start erroring with "too many connections" (memory: the deployed signup
 *     load proof hit the free-tier pooler EMAXCONN ceiling). Size it explicitly.
 *  2. DIRECT_URL pointing at the TRANSACTION pooler (port 6543 / pgbouncer).
 *     Prisma migrate takes a session advisory lock, which transaction pooling
 *     can't hold — `migrate deploy` hangs/fails (memory: "migrate diff hangs on
 *     pooler"). The migrate path must use the direct or session endpoint (5432).
 *
 * See docs/runbooks/deploy-and-rollback.md and .env.example.
 */
export function warnOnDatabasePoolingMisconfig(): void {
  if (!isProductionRuntime()) return

  const databaseUrl = readOptionalEnv('DATABASE_URL')
  if (databaseUrl && !/[?&]connection_limit=/.test(databaseUrl)) {
    console.error(
      JSON.stringify({
        level: 'warning',
        app: 'tovis',
        namespace: 'startup',
        event: 'database_url_no_connection_limit',
        message:
          'DATABASE_URL has no connection_limit. On serverless each instance opens its own pool; without an explicit limit, fan-out can exhaust Postgres/pooler connections. Add ?connection_limit=N sized for your pool. See docs/runbooks/deploy-and-rollback.md.',
      }),
    )
  }

  const directUrl = readOptionalEnv('DIRECT_URL')
  if (directUrl && (/:6543(\/|\?|$)/.test(directUrl) || /pgbouncer=true/.test(directUrl))) {
    console.error(
      JSON.stringify({
        level: 'warning',
        app: 'tovis',
        namespace: 'startup',
        event: 'direct_url_on_transaction_pooler',
        message:
          'DIRECT_URL points at the transaction pooler (port 6543 / pgbouncer=true). Prisma migrate needs a session-scoped advisory lock the transaction pooler cannot hold — migrate deploy will hang. Point DIRECT_URL at the direct/session endpoint (port 5432). See docs/runbooks/deploy-and-rollback.md.',
      }),
    )
  }
}

/**
 * Throw when a production server is missing any required env var. No-op outside
 * production. Call once at startup (instrumentation.register).
 */
export function validateProductionStartupEnv(): void {
  warnOnDivergentCronSecrets()
  warnOnDatabasePoolingMisconfig()

  const missing = collectMissingProductionEnv()
  if (missing.length === 0) return

  throw new Error(
    `Startup env validation failed in production — missing required configuration:\n` +
      missing.map((entry) => `  - ${entry}`).join('\n'),
  )
}
