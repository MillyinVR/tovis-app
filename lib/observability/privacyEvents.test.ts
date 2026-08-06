// lib/observability/privacyEvents.test.ts
//
// Mirrors the Sentry+console harness in bookingEvents.disputeAlert.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const tags: Record<string, unknown> = {}
const contexts: Record<string, unknown> = {}

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  withScope: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => sentry)

import { capturePrivacyException } from './privacyEvents'

beforeEach(() => {
  sentry.captureException.mockReset()
  for (const key of Object.keys(tags)) delete tags[key]
  for (const key of Object.keys(contexts)) delete contexts[key]
  sentry.withScope.mockImplementation((cb: (scope: unknown) => void) =>
    cb({
      setTag: vi.fn((key: string, value: unknown) => {
        tags[key] = value
      }),
      setContext: vi.fn((key: string, value: unknown) => {
        contexts[key] = value
      }),
    }),
  )
})

describe('capturePrivacyException', () => {
  it('tags the scope with area=privacy and the given route/event', () => {
    capturePrivacyException({
      error: new Error('boom'),
      route: 'GET /api/internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_SWEEP_ERROR',
    })

    expect(tags['area']).toBe('privacy')
    expect(tags['privacy.event']).toBe('ACCOUNT_DELETION_SWEEP_ERROR')
    expect(tags['privacy.route']).toBe(
      'GET /api/internal/jobs/account-deletion',
    )
    expect(sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('tags userId and requestId only when provided', () => {
    capturePrivacyException({
      error: new Error('boom'),
      route: 'internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_REQUEST_FAILED',
      userId: 'user_1',
      requestId: 'req_1',
    })

    expect(tags['privacy.userId']).toBe('user_1')
    expect(tags['privacy.requestId']).toBe('req_1')
    expect(contexts['privacy']).toEqual({
      route: 'internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_REQUEST_FAILED',
      userId: 'user_1',
      requestId: 'req_1',
    })
  })

  it('omits userId/requestId tags when absent', () => {
    capturePrivacyException({
      error: new Error('boom'),
      route: 'internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_SWEEP_ERROR',
    })

    expect(tags['privacy.userId']).toBeUndefined()
    expect(tags['privacy.requestId']).toBeUndefined()
  })

  it('redacts PII in the captured error message before it reaches Sentry', () => {
    capturePrivacyException({
      error: new Error(
        'unique constraint failed on email tori@example.com',
      ),
      route: 'internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_REQUEST_FAILED',
    })

    const captured = sentry.captureException.mock.calls[0]?.[0] as Error
    expect(captured.message).not.toContain('tori@example.com')
  })

  it('wraps a non-Error throw in an Error before capturing', () => {
    capturePrivacyException({
      error: 'a plain string throw',
      route: 'internal/jobs/account-deletion',
      event: 'ACCOUNT_DELETION_REQUEST_FAILED',
    })

    const captured = sentry.captureException.mock.calls[0]?.[0]
    expect(captured).toBeInstanceOf(Error)
  })
})
