const { URL } = require('node:url')

function normalize(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseDatabaseHost(databaseUrl) {
  const raw = normalize(databaseUrl)
  if (!raw) return null

  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

function listFromEnv(value) {
  return normalize(value)
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function isProductionRuntimeEnv() {
  const nodeEnv = normalize(process.env.NODE_ENV).toLowerCase()
  const vercelEnv = normalize(process.env.VERCEL_ENV).toLowerCase()
  const appEnv = normalize(process.env.APP_ENV).toLowerCase()

  return (
    nodeEnv === 'production' ||
    vercelEnv === 'production' ||
    appEnv === 'production'
  )
}

function hostLooksProduction(host) {
  if (!host) return false

  const explicitProductionHosts = listFromEnv(process.env.PRODUCTION_DATABASE_HOSTS)
  if (explicitProductionHosts.includes(host)) return true

  // Conservative default: if someone runs a local script against a hosted
  // Supabase URL without explicitly allowing it, treat it as production.
  // This is the SAME check prisma-guard.cjs relies on for its own separate
  // PRISMA_GUARD_ALLOW_PROD gate — it must keep returning true unconditionally
  // for every hosted host. The narrow staging exemption below only affects
  // requireSafeScriptRun, not this function.
  if (host.includes('supabase.co')) return true
  if (host.includes('pooler.supabase.com')) return true

  return false
}

function databaseLooksProduction() {
  return hostLooksProduction(parseDatabaseHost(process.env.DATABASE_URL))
}

// The prod Supabase project — never allowlistable, no matter what
// STAGING_SEED_ALLOWED_REF is set to. See prisma.config.ts / with-test-db.mjs
// (same ref, same "guard against this literal string" pattern).
const PROD_PROJECT_REF = 'rqhhvuaoksuvbvlypztn'

function connectionStringMatchesRef(databaseUrl, ref) {
  if (!ref) return false
  return normalize(databaseUrl).toLowerCase().includes(ref)
}

// A destructive script's hard block on a production-looking host may be
// bypassed ONLY when the raw connection string actually targets the ref
// named by STAGING_SEED_ALLOWED_REF — an env var that must never default to
// anything (unset/empty = no exemption, guard stays absolute) — and that
// target is never the prod project, regardless of what the allowlist var
// itself is set to. Consulted only from requireSafeScriptRun below; the
// existing allowEnvVar / CONFIRM_NON_PRODUCTION_DB checks still apply on top
// of this, unchanged, so the exemption alone is never sufficient.
function isAllowlistedStagingConnection(databaseUrl) {
  if (connectionStringMatchesRef(databaseUrl, PROD_PROJECT_REF)) return false

  const allowedRef = normalize(process.env.STAGING_SEED_ALLOWED_REF).toLowerCase()
  if (!allowedRef || allowedRef === PROD_PROJECT_REF) return false

  return connectionStringMatchesRef(databaseUrl, allowedRef)
}

function describeDatabaseHost() {
  return parseDatabaseHost(process.env.DATABASE_URL) || '(unparseable / unset)'
}

function requireSafeScriptRun(options = {}) {
  const scriptName = options.scriptName || 'unnamed-script'
  const destructive = options.destructive === true
  const allowEnvVar = options.allowEnvVar || 'ALLOW_DESTRUCTIVE_SCRIPT'

  if (isProductionRuntimeEnv()) {
    throw new Error(
      `[${scriptName}] Refusing to run in production runtime environment.`,
    )
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(`[${scriptName}] DATABASE_URL is missing.`)
  }

  if (destructive) {
    if (databaseLooksProduction() && !isAllowlistedStagingConnection(process.env.DATABASE_URL)) {
      throw new Error(
        `[${scriptName}] Refusing destructive script against a production-looking database host. ` +
          `Set PRODUCTION_DATABASE_HOSTS correctly and use a local/test DB, or set ` +
          `STAGING_SEED_ALLOWED_REF to the verified-safe staging project ref.`,
      )
    }

    if (process.env[allowEnvVar] !== '1') {
      throw new Error(
        `[${scriptName}] Destructive script blocked. Re-run with ${allowEnvVar}=1 only against a local/test DB.`,
      )
    }

    if (process.env.CONFIRM_NON_PRODUCTION_DB !== '1') {
      throw new Error(
        `[${scriptName}] Destructive script blocked. Set CONFIRM_NON_PRODUCTION_DB=1 after verifying the DB target.`,
      )
    }
  }
}

module.exports = {
  requireSafeScriptRun,
  parseDatabaseHost,
  hostLooksProduction,
  databaseLooksProduction,
  describeDatabaseHost,
  isAllowlistedStagingConnection,
}