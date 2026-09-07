// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://tovis.app/"}
import { beforeEach, describe, expect, it, vi } from 'vitest'

const init = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  init,
  captureRouterTransitionStart: vi.fn(),
}))

describe('instrumentation-client on a deployed host', () => {
  beforeEach(() => {
    vi.resetModules()
    init.mockClear()
    delete process.env.NEXT_PUBLIC_SENTRY_ALLOW_LOCAL
  })

  it('reports when the bundle carries a DSN', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@o1.ingest.sentry.io/1'
    await import('@/instrumentation-client')
    expect(init.mock.calls[0]?.[0]).toMatchObject({ enabled: true })
  })

  it('stays off with no DSN', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    await import('@/instrumentation-client')
    expect(init.mock.calls[0]?.[0]).toMatchObject({ enabled: false })
  })
})
