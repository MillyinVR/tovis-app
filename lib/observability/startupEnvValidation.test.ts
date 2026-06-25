import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collectMissingProductionEnv,
  isProductionRuntime,
  validateProductionStartupEnv,
  warnOnDivergentCronSecrets,
} from './startupEnvValidation'

// A valid AEAD keyring: one base64-encoded 32-byte key.
const VALID_AEAD_KEYRING = JSON.stringify({
  'address-aead-v1': 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
})

const MANAGED_ENV_KEYS = [
  'VERCEL_ENV',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'INTERNAL_JOB_SECRET',
  'CRON_SECRET',
  'POSTMARK_SERVER_TOKEN',
  'POSTMARK_API_TOKEN',
  'POSTMARK_NOTIFICATION_FROM_EMAIL',
  'POSTMARK_FROM_EMAIL',
  'EMAIL_FROM',
  'PII_AEAD_KEYS_JSON',
  'DATABASE_URL',
] as const

const originalEnv: Record<string, string | undefined> = {}

function setFullyConfiguredProductionEnv() {
  process.env.VERCEL_ENV = 'production'
  process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0'
  process.env.INTERNAL_JOB_SECRET = 'job-secret'
  process.env.POSTMARK_SERVER_TOKEN = 'pm-server-token'
  process.env.POSTMARK_NOTIFICATION_FROM_EMAIL = 'noreply@example.com'
  process.env.PII_AEAD_KEYS_JSON = VALID_AEAD_KEYRING
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
}

beforeEach(() => {
  for (const key of MANAGED_ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of MANAGED_ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
})

describe('isProductionRuntime', () => {
  it('is false when VERCEL_ENV is unset', () => {
    expect(isProductionRuntime()).toBe(false)
  })

  it('is false for preview deployments', () => {
    process.env.VERCEL_ENV = 'preview'
    expect(isProductionRuntime()).toBe(false)
  })

  it('is true only for production', () => {
    process.env.VERCEL_ENV = 'production'
    expect(isProductionRuntime()).toBe(true)
  })
})

describe('validateProductionStartupEnv', () => {
  it('does not throw outside production even when everything is missing', () => {
    process.env.VERCEL_ENV = 'preview'
    expect(() => validateProductionStartupEnv()).not.toThrow()
    expect(collectMissingProductionEnv()).toEqual([])
  })

  it('does not throw in production when all required env is present', () => {
    setFullyConfiguredProductionEnv()
    expect(() => validateProductionStartupEnv()).not.toThrow()
    expect(collectMissingProductionEnv()).toEqual([])
  })

  it('accepts the CRON_SECRET fallback for the job secret', () => {
    setFullyConfiguredProductionEnv()
    delete process.env.INTERNAL_JOB_SECRET
    process.env.CRON_SECRET = 'cron-secret'
    expect(() => validateProductionStartupEnv()).not.toThrow()
  })

  it('throws and names every missing var in production', () => {
    process.env.VERCEL_ENV = 'production'

    const missing = collectMissingProductionEnv()
    expect(missing).toHaveLength(5)
    expect(missing.some((entry) => entry.startsWith('Sentry DSN'))).toBe(true)
    expect(
      missing.some((entry) => entry.startsWith('Internal job / cron secret')),
    ).toBe(true)
    expect(
      missing.some((entry) => entry.startsWith('Postmark email provider')),
    ).toBe(true)
    expect(
      missing.some((entry) => entry.startsWith('PII encryption keyring')),
    ).toBe(true)
    expect(missing.some((entry) => entry.startsWith('Database URL'))).toBe(true)

    expect(() => validateProductionStartupEnv()).toThrow(
      /Startup env validation failed in production/,
    )
  })

  it('throws when the PII keyring is present but malformed', () => {
    setFullyConfiguredProductionEnv()
    process.env.PII_AEAD_KEYS_JSON = '{"bad":"not-base64-32-bytes"}'

    expect(collectMissingProductionEnv()).toEqual([
      expect.stringContaining('PII encryption keyring'),
    ])
    expect(() => validateProductionStartupEnv()).toThrow(/PII encryption keyring/)
  })

  it('throws when only the Sentry DSN is missing', () => {
    setFullyConfiguredProductionEnv()
    delete process.env.SENTRY_DSN

    expect(() => validateProductionStartupEnv()).toThrow(/Sentry DSN/)
  })

  it('throws when Postmark has a token but no from-address', () => {
    setFullyConfiguredProductionEnv()
    delete process.env.POSTMARK_NOTIFICATION_FROM_EMAIL

    const missing = collectMissingProductionEnv()
    expect(missing).toEqual([
      expect.stringContaining('Postmark email provider'),
    ])
    expect(() => validateProductionStartupEnv()).toThrow(/Postmark/)
  })
})

describe('warnOnDivergentCronSecrets', () => {
  it('warns in production when INTERNAL_JOB_SECRET and CRON_SECRET differ', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.INTERNAL_JOB_SECRET = 'aaa'
    process.env.CRON_SECRET = 'bbb'

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnOnDivergentCronSecrets()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toContain('divergent_cron_secrets')
    spy.mockRestore()
  })

  it('does not warn when the two secrets match', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.INTERNAL_JOB_SECRET = 'same'
    process.env.CRON_SECRET = 'same'

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnOnDivergentCronSecrets()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not warn outside production', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.INTERNAL_JOB_SECRET = 'aaa'
    process.env.CRON_SECRET = 'bbb'

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnOnDivergentCronSecrets()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
