// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost:3200/"}
import { beforeEach, describe, expect, it, vi } from 'vitest'

const init = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  init,
  captureRouterTransitionStart: vi.fn(),
}))

describe('instrumentation-client at localhost', () => {
  beforeEach(() => {
    vi.resetModules()
    init.mockClear()
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://key@o1.ingest.sentry.io/1'
    delete process.env.NEXT_PUBLIC_SENTRY_ALLOW_LOCAL
  })

  it('keeps the browser SDK disabled even though the bundle carries a DSN', async () => {
    await import('@/instrumentation-client')
    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0]?.[0]).toMatchObject({ enabled: false })
  })

  it('NEXT_PUBLIC_SENTRY_ALLOW_LOCAL=1 opts the laptop in', async () => {
    process.env.NEXT_PUBLIC_SENTRY_ALLOW_LOCAL = '1'
    await import('@/instrumentation-client')
    expect(init.mock.calls[0]?.[0]).toMatchObject({ enabled: true })
  })
})
