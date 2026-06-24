import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// CJS interop: the guard and its shared helper are plain CommonJS modules.
const { destructiveKey } = require('./prisma-guard.cjs') as {
  destructiveKey: (args: string[]) => string | null
}
const {
  parseDatabaseHost,
  hostLooksProduction,
  databaseLooksProduction,
} = require('./_safe-script-guard.cjs') as {
  parseDatabaseHost: (url: string | undefined) => string | null
  hostLooksProduction: (host: string | null) => boolean
  databaseLooksProduction: () => boolean
}

describe('destructiveKey', () => {
  it('flags the destructive schema commands', () => {
    expect(destructiveKey(['db', 'push'])).toBe('db push')
    expect(destructiveKey(['db', 'push', '--skip-generate'])).toBe('db push')
    expect(destructiveKey(['migrate', 'dev', '--name', 'add_col'])).toBe('migrate dev')
    expect(destructiveKey(['migrate', 'dev', '--name=add_col'])).toBe('migrate dev')
    expect(destructiveKey(['migrate', 'reset', '--force'])).toBe('migrate reset')
    expect(destructiveKey(['db', 'execute', '--file', 'x.sql'])).toBe('db execute')
  })

  it('allows read-only and production-sanctioned commands through', () => {
    // migrate deploy is the sanctioned prod path; must NOT be blocked.
    expect(destructiveKey(['migrate', 'deploy'])).toBeNull()
    expect(destructiveKey(['migrate', 'status'])).toBeNull()
    expect(destructiveKey(['migrate', 'diff'])).toBeNull()
    expect(destructiveKey(['db', 'pull'])).toBeNull()
    expect(destructiveKey(['generate'])).toBeNull()
    expect(destructiveKey(['db', 'seed'])).toBeNull()
    expect(destructiveKey([])).toBeNull()
    expect(destructiveKey(['--help'])).toBeNull()
  })
})

describe('hostLooksProduction', () => {
  it('treats hosted Supabase hosts as production', () => {
    expect(
      hostLooksProduction(
        parseDatabaseHost(
          'postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
        ),
      ),
    ).toBe(true)
    expect(
      hostLooksProduction(parseDatabaseHost('postgresql://u:p@db.abc.supabase.co:5432/postgres')),
    ).toBe(true)
  })

  it('treats localhost as safe', () => {
    expect(
      hostLooksProduction(parseDatabaseHost('postgresql://postgres:postgres@localhost:5434/tovis_dev')),
    ).toBe(false)
    expect(hostLooksProduction(parseDatabaseHost('postgresql://u:p@127.0.0.1:5433/db'))).toBe(false)
    expect(hostLooksProduction(parseDatabaseHost(undefined))).toBe(false)
  })

  it('honors PRODUCTION_DATABASE_HOSTS allowlist', () => {
    const prev = process.env.PRODUCTION_DATABASE_HOSTS
    process.env.PRODUCTION_DATABASE_HOSTS = 'my-prod-host.example.com'
    try {
      expect(
        hostLooksProduction(parseDatabaseHost('postgresql://u:p@my-prod-host.example.com:5432/db')),
      ).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.PRODUCTION_DATABASE_HOSTS
      else process.env.PRODUCTION_DATABASE_HOSTS = prev
    }
  })
})

describe('databaseLooksProduction (reads DATABASE_URL)', () => {
  const prev = process.env.DATABASE_URL
  afterEach(() => {
    if (prev === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = prev
  })

  it('blocks a Supabase pooler URL and clears for localhost', () => {
    process.env.DATABASE_URL =
      'postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true'
    expect(databaseLooksProduction()).toBe(true)

    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5434/tovis_dev'
    expect(databaseLooksProduction()).toBe(false)
  })
})
