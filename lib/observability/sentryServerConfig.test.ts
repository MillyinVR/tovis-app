import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Proves the WIRING, not just the helper: the real sentry.server.config.ts and
// sentry.edge.config.ts must hand `Sentry.init` an `enabled` that follows the
// deployed-runtime gate.
const init = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  init,
  consoleLoggingIntegration: vi.fn(() => ({ name: 'ConsoleLogging' })),
}))

const DSN = 'https://key@o1.ingest.sentry.io/1'
const saved = {
  SENTRY_DSN: process.env.SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  VERCEL_ENV: process.env.VERCEL_ENV,
  SENTRY_ALLOW_LOCAL: process.env.SENTRY_ALLOW_LOCAL,
}

beforeEach(() => {
  vi.resetModules()
  init.mockClear()
  process.env.SENTRY_DSN = DSN
  delete process.env.NEXT_PUBLIC_SENTRY_DSN
  delete process.env.VERCEL_ENV
  delete process.env.SENTRY_ALLOW_LOCAL
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe.each([
  ['sentry.server.config', () => import('@/sentry.server.config')],
  ['sentry.edge.config', () => import('@/sentry.edge.config')],
])('%s', (_name, load) => {
  it('disables the SDK on a laptop that carries the live DSN', async () => {
    await load()
    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0]?.[0]).toMatchObject({ dsn: DSN, enabled: false })
  })

  it('enables the SDK on a Vercel production deployment', async () => {
    process.env.VERCEL_ENV = 'production'
    await load()
    expect(init.mock.calls[0]?.[0]).toMatchObject({ dsn: DSN, enabled: true })
  })

  it('enables the SDK on a Vercel preview deployment', async () => {
    process.env.VERCEL_ENV = 'preview'
    await load()
    expect(init.mock.calls[0]?.[0]).toMatchObject({ enabled: true })
  })

  it('SENTRY_ALLOW_LOCAL=1 opts a laptop in', async () => {
    process.env.SENTRY_ALLOW_LOCAL = '1'
    await load()
    expect(init.mock.calls[0]?.[0]).toMatchObject({ enabled: true })
  })
})
