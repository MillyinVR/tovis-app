// lib/observability/scheduledJobEvents.test.ts

import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  setLevel: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (scope: unknown) => void) =>
    fn({
      setLevel: mocks.setLevel,
      setTag: mocks.setTag,
      setContext: mocks.setContext,
    }),
  captureException: mocks.captureException,
}))

import { captureScheduledJobException } from './scheduledJobEvents'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('captureScheduledJobException', () => {
  it('tags the job path and event, defaulting to error level', () => {
    captureScheduledJobException({
      error: new Error('boom'),
      job: '/api/internal/jobs/client-reminders',
      event: 'CLIENT_REMINDERS_SWEEP_ERROR',
    })

    expect(mocks.setLevel).toHaveBeenCalledWith('error')
    expect(mocks.setTag).toHaveBeenCalledWith('area', 'scheduled-job')
    expect(mocks.setTag).toHaveBeenCalledWith(
      'job.path',
      '/api/internal/jobs/client-reminders',
    )
    expect(mocks.setTag).toHaveBeenCalledWith(
      'job.event',
      'CLIENT_REMINDERS_SWEEP_ERROR',
    )
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
  })

  it('honours an explicit warning level', () => {
    captureScheduledJobException({
      error: new Error('boom'),
      job: '/j',
      event: 'E',
      level: 'warning',
    })

    expect(mocks.setLevel).toHaveBeenCalledWith('warning')
  })

  // The whole point of routing through safeError: a sweep error can carry a
  // signed URL or a token in its message, and this helper is the last thing
  // between it and Sentry.
  it('redacts the message through safeError before capturing', () => {
    captureScheduledJobException({
      error: new Error('purge failed for tori@example.com'),
      job: '/j',
      event: 'E',
    })

    const captured = mocks.captureException.mock.calls[0]?.[0] as Error
    expect(captured).toBeInstanceOf(Error)
    expect(captured.message).not.toContain('tori@example.com')
  })

  it('survives a non-Error throw', () => {
    captureScheduledJobException({ error: 'just a string', job: '/j', event: 'E' })

    // safeError names a non-Error throw NonErrorThrown; its message is free text
    // so sanitizeString redacts it wholesale rather than guessing what is in it.
    const captured = mocks.captureException.mock.calls[0]?.[0] as Error
    expect(captured.name).toBe('NonErrorThrown')
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
  })
})
