// lib/loadTestDelivery.ts
//
// Opt-in kill switch that suppresses REAL outbound provider delivery (Twilio
// SMS/Verify, Postmark email) so load tests can exercise signup / notification
// flows without making — and being billed for — live provider calls.
//
// Where it engages: local dev, CI, AND preview/staging deploys — but NEVER
// production. A deployed load proof runs on a Vercel *preview* (staging) target,
// so the switch must work there; production is hard-fenced so it can never stop
// delivery to real users, even if the flag leaks into prod config. The proof
// that real delivery works is the separate deployed *smoke* proof (a few real
// signups), not the load proof (thousands of suppressed signups).

import { readOptionalEnv } from '@/lib/env'

const FLAG = 'LOAD_TEST_DISABLE_REAL_DELIVERY'

const LOAD_TEST_DELIVERY_FLAG_IN_PROD_LOGGED_KEY =
  '__tovisLoadTestDeliveryFlagInProdLogged' as const

type LoadTestDeliveryGlobalState = typeof globalThis & {
  [LOAD_TEST_DELIVERY_FLAG_IN_PROD_LOGGED_KEY]?: boolean
}

function flagOptedIn(): boolean {
  const raw = readOptionalEnv(FLAG)?.toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/**
 * Production is the one surface where delivery must never be suppressed. Keyed
 * on VERCEL_ENV (the canonical deploy signal) — preview/staging is allowed.
 */
function isProductionRuntime(): boolean {
  return readOptionalEnv('VERCEL_ENV') === 'production'
}

function reportFlagIgnoredInProductionOnce(): void {
  const globalState = globalThis as LoadTestDeliveryGlobalState
  if (globalState[LOAD_TEST_DELIVERY_FLAG_IN_PROD_LOGGED_KEY]) return

  globalState[LOAD_TEST_DELIVERY_FLAG_IN_PROD_LOGGED_KEY] = true
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      app: 'tovis-app',
      namespace: 'notifications',
      level: 'error',
      event: 'load_test_delivery_flag_ignored_in_production',
      message: `${FLAG} is set in PRODUCTION and is being IGNORED; real provider delivery stays ON.`,
    }),
  )
}

/**
 * True when real provider delivery should be skipped for this process.
 *
 * Returns false in production regardless of the flag (and logs once, so a leaked
 * flag is visible rather than silently disabling delivery to real users).
 */
export function realDeliverySuppressed(): boolean {
  if (!flagOptedIn()) return false

  if (isProductionRuntime()) {
    reportFlagIgnoredInProductionOnce()
    return false
  }

  return true
}

/**
 * Status marker stamped on suppressed sends so logs/records make the no-op
 * obvious instead of looking like a genuine provider acceptance.
 */
export const LOAD_TEST_SUPPRESSED_STATUS = 'load_test_suppressed' as const
