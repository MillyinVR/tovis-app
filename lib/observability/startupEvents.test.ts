import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  setLevel: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureMessage: mocks.captureMessage,
  withScope: (fn: (scope: unknown) => void) => {
    fn({
      setLevel: mocks.setLevel,
      setTag: mocks.setTag,
      setContext: mocks.setContext,
    })
  },
}))

import { captureStartupMisconfig } from './startupEvents'

describe('captureStartupMisconfig', () => {
  it('captures a message tagged to the startup area at the given level', () => {
    vi.clearAllMocks()

    captureStartupMisconfig({
      event: 'divergent_cron_secrets',
      message: 'INTERNAL_JOB_SECRET and CRON_SECRET differ.',
      level: 'error',
    })

    expect(mocks.setLevel).toHaveBeenCalledWith('error')
    expect(mocks.setTag).toHaveBeenCalledWith('area', 'startup')
    expect(mocks.setTag).toHaveBeenCalledWith(
      'startup.event',
      'divergent_cron_secrets',
    )
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      'startup misconfiguration: divergent_cron_secrets',
    )
    // The human-readable explanation must actually reach Sentry — it is the
    // whole point of the alert, and an unused `message` param would look
    // correct at every call site while shipping nothing.
    expect(mocks.setContext).toHaveBeenCalledWith(
      'startup',
      expect.objectContaining({
        message: 'INTERNAL_JOB_SECRET and CRON_SECRET differ.',
      }),
    )
  })

  it('honours a warning level', () => {
    vi.clearAllMocks()

    captureStartupMisconfig({
      event: 'direct_url_on_transaction_pooler',
      message: 'DIRECT_URL points at the transaction pooler.',
      level: 'warning',
    })

    expect(mocks.setLevel).toHaveBeenCalledWith('warning')
    expect(mocks.captureMessage).toHaveBeenCalledTimes(1)
  })
})
