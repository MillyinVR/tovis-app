import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  collectMissingProductionEnv,
  isProductionRuntime,
  validateProductionStartupEnv,
} from './startupEnvValidation'

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
] as const

const originalEnv: Record<string, string | undefined> = {}

function setFullyConfiguredProductionEnv() {
  process.env.VERCEL_ENV = 'production'
  process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0'
  process.env.INTERNAL_JOB_SECRET = 'job-secret'
  process.env.POSTMARK_SERVER_TOKEN = 'pm-server-token'
  process.env.POSTMARK_NOTIFICATION_FROM_EMAIL = 'noreply@example.com'
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
    expect(missing).toHaveLength(3)
    expect(missing.some((entry) => entry.startsWith('Sentry DSN'))).toBe(true)
    expect(
      missing.some((entry) => entry.startsWith('Internal job / cron secret')),
    ).toBe(true)
    expect(
      missing.some((entry) => entry.startsWith('Postmark email provider')),
    ).toBe(true)

    expect(() => validateProductionStartupEnv()).toThrow(
      /Startup env validation failed in production/,
    )
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
