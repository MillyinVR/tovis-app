import { afterEach, describe, expect, it } from 'vitest'

import {
  assertConsultStorageEnvironment,
  consultCaptureObjectPath,
  ConsultCaptureStorageError,
} from './captureStorage'

const ORIGINAL = {
  database: process.env.DATABASE_URL,
  storage: process.env.NEXT_PUBLIC_SUPABASE_URL,
  fallbackStorage: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

afterEach(() => {
  process.env.DATABASE_URL = ORIGINAL.database
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL.storage
  process.env.SUPABASE_URL = ORIGINAL.fallbackStorage
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL.key
})

describe('consult private storage contract', () => {
  it('accepts matching local and matching remote project identities', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/test'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    expect(() => assertConsultStorageEnvironment()).not.toThrow()

    process.env.DATABASE_URL =
      'postgresql://postgres.projectref:password@aws-0-us-west-1.pooler.supabase.com:6543/postgres'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://projectref.supabase.co'
    expect(() => assertConsultStorageEnvironment()).not.toThrow()
  })

  it.each([
    ['missing database', undefined, 'https://projectref.supabase.co', 'key'],
    ['missing key', 'postgresql://postgres@localhost:5433/test', 'http://localhost:54321', undefined],
    ['local/remote mismatch', 'postgresql://postgres@localhost:5433/test', 'https://projectref.supabase.co', 'key'],
    ['remote project mismatch', 'postgresql://postgres.one:x@pooler.supabase.com/postgres', 'https://two.supabase.co', 'key'],
  ])('fails closed for %s', (_label, database, storage, key) => {
    if (database === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = database
    if (storage === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = storage
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key
    expect(() => assertConsultStorageEnvironment()).toThrow(
      ConsultCaptureStorageError,
    )
  })

  it('mints opaque paths without owner, consult, booking, or slot identifiers', () => {
    const path = consultCaptureObjectPath('image/jpeg')
    expect(path).toMatch(
      /^consult-raw\/v1\/[0-9a-f-]{36}\.jpg$/,
    )
    expect(path).not.toContain('client')
    expect(path).not.toContain('booking')
    expect(path).not.toContain('hair_back')
  })
})
