import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getStorageEnvironmentMismatch } from '@/lib/media/storageEnvironment'

// The guard's whole job is to fire in exactly ONE situation and stay silent in
// every other, because a false positive would refuse uploads in production. These
// pin both halves — most of all the fail-open cases.
//
// Env is driven through vi.stubEnv rather than assignment: NODE_ENV is a
// read-only property to TypeScript, so `process.env.NODE_ENV = …` passes vitest
// and fails tsc (which only surfaces in CI).

const LOCAL_DB = 'postgresql://postgres:postgres@localhost:5434/tovis_dev'
const REMOTE_STORAGE = 'https://abcdefg.supabase.co'

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_URL', '')
  vi.stubEnv('TOVIS_ALLOW_REMOTE_STORAGE_FROM_LOCAL', '')
  // vitest runs as NODE_ENV=test, which short-circuits the guard — step out of
  // that so the real logic is under test, and pin the short-circuit separately.
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getStorageEnvironmentMismatch', () => {
  it('fires on the real trap: a local database with remote storage', () => {
    vi.stubEnv('DATABASE_URL', LOCAL_DB)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', REMOTE_STORAGE)

    const message = getStorageEnvironmentMismatch()

    expect(message).toContain('Refusing to sign an upload')
    expect(message).toContain('localhost')
    expect(message).toContain('abcdefg.supabase.co')
  })

  it('reads SUPABASE_URL when NEXT_PUBLIC_SUPABASE_URL is absent (same precedence as the admin client)', () => {
    vi.stubEnv('DATABASE_URL', LOCAL_DB)
    vi.stubEnv('SUPABASE_URL', REMOTE_STORAGE)

    expect(getStorageEnvironmentMismatch()).toContain('Refusing to sign an upload')
  })

  it('prefers NEXT_PUBLIC_SUPABASE_URL, like getSupabaseAdmin does', () => {
    vi.stubEnv('DATABASE_URL', LOCAL_DB)
    // The one that WINS is local, so there is no mismatch — even though the other
    // is remote. Reading the wrong one here would refuse a working setup.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('SUPABASE_URL', REMOTE_STORAGE)

    expect(getStorageEnvironmentMismatch()).toBeNull()
  })

  // ── Fail-open: everything below MUST stay null ──────────────────────────────

  it('stays silent in production (a remote database)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@db.abcdefg.supabase.co:5432/postgres')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', REMOTE_STORAGE)

    expect(getStorageEnvironmentMismatch()).toBeNull()
  })

  it('stays silent in CI, where both are local', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:5432/tovis_test')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')

    expect(getStorageEnvironmentMismatch()).toBeNull()
  })

  it('stays silent under vitest, where storage is mocked', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', LOCAL_DB)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', REMOTE_STORAGE)

    expect(getStorageEnvironmentMismatch()).toBeNull()
  })

  it('honors the escape hatch', () => {
    vi.stubEnv('DATABASE_URL', LOCAL_DB)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', REMOTE_STORAGE)
    vi.stubEnv('TOVIS_ALLOW_REMOTE_STORAGE_FROM_LOCAL', '1')

    expect(getStorageEnvironmentMismatch()).toBeNull()
  })

  it.each([
    ['no DATABASE_URL', { DATABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: REMOTE_STORAGE }],
    ['no storage URL', { DATABASE_URL: LOCAL_DB, NEXT_PUBLIC_SUPABASE_URL: '' }],
    ['an unparseable DATABASE_URL', { DATABASE_URL: 'not-a-url', NEXT_PUBLIC_SUPABASE_URL: REMOTE_STORAGE }],
    ['an unparseable storage URL', { DATABASE_URL: LOCAL_DB, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' }],
  ])('fails OPEN on %s rather than refusing', (_label, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)

    // Unrecognized > refused: this guard must never be the reason a real upload
    // fails, so anything it cannot positively identify is treated as fine.
    expect(getStorageEnvironmentMismatch()).toBeNull()
  })
})
