import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// CJS interop: the guard is a plain CommonJS module.
const {
  parseDatabaseHost,
  hostLooksProduction,
  databaseLooksProduction,
  isAllowlistedStagingConnection,
  requireSafeScriptRun,
} = require('./_safe-script-guard.cjs') as {
  parseDatabaseHost: (url: string | undefined) => string | null
  hostLooksProduction: (host: string | null) => boolean
  databaseLooksProduction: () => boolean
  isAllowlistedStagingConnection: (databaseUrl: string | undefined) => boolean
  requireSafeScriptRun: (options?: {
    scriptName?: string
    destructive?: boolean
    allowEnvVar?: string
  }) => void
}

// The real prod ref (also asserted against in prisma.config.ts / with-test-db.mjs)
// — used here to prove it can never be smuggled through the allowlist.
const PROD_REF = 'rqhhvuaoksuvbvlypztn'
const STAGING_REF = 'zzzstagingref0000001'
const OTHER_HOSTED_REF = 'somethingelseref0001'

const STAGING_URL = `postgresql://postgres.${STAGING_REF}:pw@aws-1-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
const PROD_URL = `postgresql://postgres.${PROD_REF}:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true`
const OTHER_HOSTED_URL = `postgresql://postgres.${OTHER_HOSTED_REF}:pw@aws-1-us-west-1.pooler.supabase.com:6543/postgres`

const ENV_KEYS = [
  'DATABASE_URL',
  'STAGING_SEED_ALLOWED_REF',
  'ALLOW_DESTRUCTIVE_SCRIPT',
  'CONFIRM_NON_PRODUCTION_DB',
  'PRODUCTION_DATABASE_HOSTS',
  'VERCEL_ENV',
  'APP_ENV',
] as const

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('hostLooksProduction / databaseLooksProduction — unaffected by the staging allowlist', () => {
  const prevEnv = snapshotEnv()
  afterEach(() => restoreEnv(prevEnv))

  it('still flags every hosted Supabase host as production, even with a matching allowlist set', () => {
    // This is the check prisma-guard.cjs's separate PRISMA_GUARD_ALLOW_PROD
    // gate relies on — the staging exemption must NOT leak into it.
    process.env.STAGING_SEED_ALLOWED_REF = STAGING_REF
    process.env.DATABASE_URL = STAGING_URL

    expect(databaseLooksProduction()).toBe(true)
    expect(hostLooksProduction(parseDatabaseHost(STAGING_URL))).toBe(true)
  })
})

describe('isAllowlistedStagingConnection', () => {
  const prevEnv = snapshotEnv()
  afterEach(() => restoreEnv(prevEnv))

  it('absolute block: no exemption with no allowlist var set', () => {
    delete process.env.STAGING_SEED_ALLOWED_REF
    expect(isAllowlistedStagingConnection(STAGING_URL)).toBe(false)
  })

  it('empty-string allowlist var never defaults to allowing anything', () => {
    process.env.STAGING_SEED_ALLOWED_REF = ''
    expect(isAllowlistedStagingConnection(STAGING_URL)).toBe(false)
  })

  it('exempts a connection whose ref matches the allowlist var', () => {
    process.env.STAGING_SEED_ALLOWED_REF = STAGING_REF
    expect(isAllowlistedStagingConnection(STAGING_URL)).toBe(true)

    // A different hosted ref, even with the allowlist set to something, is
    // still not exempt — matching is against the ref actually named.
    expect(isAllowlistedStagingConnection(OTHER_HOSTED_URL)).toBe(false)
  })

  it('hard-rejects the prod ref even when it is placed in the allowlist var', () => {
    process.env.STAGING_SEED_ALLOWED_REF = PROD_REF
    expect(isAllowlistedStagingConnection(PROD_URL)).toBe(false)

    // And even when the allowlist names a *different*, legitimate staging ref,
    // a connection string that actually targets prod must stay blocked.
    process.env.STAGING_SEED_ALLOWED_REF = STAGING_REF
    expect(isAllowlistedStagingConnection(PROD_URL)).toBe(false)
  })
})

describe('requireSafeScriptRun — staging allowlist end-to-end', () => {
  const prevEnv = snapshotEnv()
  afterEach(() => {
    restoreEnv(prevEnv)
    vi.unstubAllEnvs()
  })

  function resetRuntimeEnvGuards() {
    // NODE_ENV is typed read-only on process.env; vi.stubEnv is the vitest-
    // sanctioned way to override it (and vi.unstubAllEnvs restores it).
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.VERCEL_ENV
    delete process.env.APP_ENV
  }

  it('blocks a hosted DB outright when no allowlist is set (unchanged default)', () => {
    resetRuntimeEnvGuards()
    delete process.env.STAGING_SEED_ALLOWED_REF
    process.env.DATABASE_URL = STAGING_URL
    process.env.ALLOW_DESTRUCTIVE_SCRIPT = '1'
    process.env.CONFIRM_NON_PRODUCTION_DB = '1'

    expect(() => requireSafeScriptRun({ scriptName: 'test-script', destructive: true })).toThrow(
      /production-looking database host/,
    )
  })

  it('proceeds against the allowlisted staging DB only once the existing confirm flags are ALSO set', () => {
    resetRuntimeEnvGuards()
    process.env.STAGING_SEED_ALLOWED_REF = STAGING_REF
    process.env.DATABASE_URL = STAGING_URL
    delete process.env.ALLOW_DESTRUCTIVE_SCRIPT
    delete process.env.CONFIRM_NON_PRODUCTION_DB

    // Ref is allowlisted, but neither confirm flag is set yet — still blocked.
    expect(() => requireSafeScriptRun({ scriptName: 'test-script', destructive: true })).toThrow(
      /ALLOW_DESTRUCTIVE_SCRIPT/,
    )

    process.env.ALLOW_DESTRUCTIVE_SCRIPT = '1'
    expect(() => requireSafeScriptRun({ scriptName: 'test-script', destructive: true })).toThrow(
      /CONFIRM_NON_PRODUCTION_DB/,
    )

    process.env.CONFIRM_NON_PRODUCTION_DB = '1'
    expect(() =>
      requireSafeScriptRun({ scriptName: 'test-script', destructive: true }),
    ).not.toThrow()
  })

  it('never proceeds against prod, even with the ref allowlisted and both confirm flags set', () => {
    resetRuntimeEnvGuards()
    process.env.STAGING_SEED_ALLOWED_REF = PROD_REF
    process.env.DATABASE_URL = PROD_URL
    process.env.ALLOW_DESTRUCTIVE_SCRIPT = '1'
    process.env.CONFIRM_NON_PRODUCTION_DB = '1'

    expect(() => requireSafeScriptRun({ scriptName: 'test-script', destructive: true })).toThrow(
      /production-looking database host/,
    )
  })

  it('non-destructive runs are unaffected by the allowlist (no DB-host check applies)', () => {
    resetRuntimeEnvGuards()
    delete process.env.STAGING_SEED_ALLOWED_REF
    process.env.DATABASE_URL = STAGING_URL

    expect(() =>
      requireSafeScriptRun({ scriptName: 'test-script', destructive: false }),
    ).not.toThrow()
  })
})
