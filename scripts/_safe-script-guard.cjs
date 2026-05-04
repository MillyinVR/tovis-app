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

function databaseLooksProduction() {
  const databaseUrl = process.env.DATABASE_URL
  const host = parseDatabaseHost(databaseUrl)

  if (!host) return false

  const explicitProductionHosts = listFromEnv(process.env.PRODUCTION_DATABASE_HOSTS)
  if (explicitProductionHosts.includes(host)) return true

  // Conservative default: if someone runs a local script against a hosted
  // Supabase URL without explicitly allowing it, block destructive scripts.
  if (host.includes('supabase.co')) return true
  if (host.includes('pooler.supabase.com')) return true

  return false
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
    if (databaseLooksProduction()) {
      throw new Error(
        `[${scriptName}] Refusing destructive script against a production-looking database host. ` +
          `Set PRODUCTION_DATABASE_HOSTS correctly and use a local/test DB.`,
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
}