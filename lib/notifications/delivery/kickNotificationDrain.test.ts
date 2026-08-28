import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  waitUntil: vi.fn(),
  drainDueNotifications: vi.fn(),
  captureNotificationException: vi.fn(),
}))

// Both failure paths below are non-fatal by design (the cron backstops
// delivery), so the capture is the ONLY thing that surfaces them — the console
// lines they also write are invisible to Sentry unless SENTRY_ENABLE_LOGS is on,
// and it is off by default.
vi.mock('@/lib/observability/notificationEvents', () => ({
  captureNotificationException: mocks.captureNotificationException,
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: mocks.waitUntil,
}))

vi.mock('./runNotificationDrain', () => ({
  drainDueNotifications: mocks.drainDueNotifications,
}))

import { kickNotificationDrain } from './kickNotificationDrain'

describe('lib/notifications/delivery/kickNotificationDrain', () => {
  const originalVitestEnv = process.env.VITEST

  beforeEach(() => {
    vi.clearAllMocks()
    // The kick no-ops under the test runner by design; clear the flag so this
    // suite exercises the real scheduling behavior.
    delete process.env.VITEST
    mocks.drainDueNotifications.mockResolvedValue({
      claimedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalVitestEnv === undefined) {
      delete process.env.VITEST
    } else {
      process.env.VITEST = originalVitestEnv
    }
  })

  it('schedules a drain via waitUntil', () => {
    kickNotificationDrain({ batchSize: 50 })

    expect(mocks.drainDueNotifications).toHaveBeenCalledWith({ batchSize: 50 })
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1)
    expect(mocks.waitUntil.mock.calls[0]?.[0]).toBeInstanceOf(Promise)
  })

  it('swallows a drain rejection so the caller never sees it', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    mocks.drainDueNotifications.mockRejectedValueOnce(new Error('drain boom'))

    expect(() => kickNotificationDrain()).not.toThrow()

    // The scheduled promise resolves (rejection swallowed), not rejects.
    const scheduled = mocks.waitUntil.mock.calls[0]?.[0] as Promise<unknown>
    await expect(scheduled).resolves.toBeUndefined()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'kickNotificationDrain: drain failed',
      expect.objectContaining({ error: expect.anything() }),
    )
    expect(mocks.captureNotificationException).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'kickNotificationDrain',
        event: 'DRAIN_KICK_FAILED',
      }),
    )

    consoleErrorSpy.mockRestore()
  })

  it('never throws into the caller when waitUntil is unavailable', () => {
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)

    mocks.waitUntil.mockImplementationOnce(() => {
      throw new Error('waitUntil() cannot be called outside a request scope')
    })

    expect(() => kickNotificationDrain()).not.toThrow()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'kickNotificationDrain: waitUntil unavailable; relying on cron',
      expect.objectContaining({ error: expect.anything() }),
    )
    // Warning, not error: nothing is lost, the cron still drains — but in
    // production waitUntil should always be available, so it must be visible.
    expect(mocks.captureNotificationException).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'kickNotificationDrain',
        event: 'WAIT_UNTIL_UNAVAILABLE',
        level: 'warning',
      }),
    )

    consoleWarnSpy.mockRestore()
  })
})
