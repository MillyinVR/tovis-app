import { afterEach, describe, expect, it } from 'vitest'

import { isSentryServerReportingEnabled } from './sentryConfig'

const DSN = 'https://key@o1.ingest.sentry.io/1'
const saved = { VERCEL_ENV: process.env.VERCEL_ENV, SENTRY_ALLOW_LOCAL: process.env.SENTRY_ALLOW_LOCAL }

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('isSentryServerReportingEnabled', () => {
  it.each(['production', 'preview'])('reports on VERCEL_ENV=%s', (env) => {
    process.env.VERCEL_ENV = env
    delete process.env.SENTRY_ALLOW_LOCAL
    expect(isSentryServerReportingEnabled(DSN)).toBe(true)
  })

  it('is silent when VERCEL_ENV is unset (laptop, CI, tests)', () => {
    delete process.env.VERCEL_ENV
    delete process.env.SENTRY_ALLOW_LOCAL
    expect(isSentryServerReportingEnabled(DSN)).toBe(false)
  })

  it('is silent under `vercel dev`', () => {
    process.env.VERCEL_ENV = 'development'
    delete process.env.SENTRY_ALLOW_LOCAL
    expect(isSentryServerReportingEnabled(DSN)).toBe(false)
  })

  it('SENTRY_ALLOW_LOCAL=1 opts a local run in', () => {
    delete process.env.VERCEL_ENV
    process.env.SENTRY_ALLOW_LOCAL = '1'
    expect(isSentryServerReportingEnabled(DSN)).toBe(true)
  })

  it('a deployment without a DSN still reports nothing', () => {
    process.env.VERCEL_ENV = 'production'
    expect(isSentryServerReportingEnabled(undefined)).toBe(false)
  })
})
