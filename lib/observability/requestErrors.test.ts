// lib/observability/requestErrors.test.ts

import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureRequestError: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureRequestError: mocks.captureRequestError,
}))

import { captureRouteRequestError } from './requestErrors'

const REQUEST = {
  path: '/api/v1/pro/bookings',
  method: 'POST',
  headers: {
    cookie: 'tovis_token=eyJhbGciOiJIUzI1NiJ9.payload.signature',
    authorization: 'Bearer secret',
    'user-agent': 'tovis-ios/1.0',
  },
}

const CONTEXT = {
  routerKind: 'App Router',
  routePath: '/api/v1/pro/bookings',
  routeType: 'route',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('captureRouteRequestError', () => {
  it('forwards the error and the route identity to Sentry', () => {
    const error = new Error('boom')

    captureRouteRequestError(error, REQUEST, CONTEXT)

    expect(mocks.captureRequestError).toHaveBeenCalledTimes(1)
    const [captured, request, context] = mocks.captureRequestError.mock.calls[0] ?? []
    // The ORIGINAL error, stack intact — unlike the capture* helpers, which
    // rebuild it from safeError() and lose the frames. Content redaction still
    // happens, globally, in `beforeSend: scrubSentryEvent`.
    expect(captured).toBe(error)
    expect(request).toMatchObject({
      path: '/api/v1/pro/bookings',
      method: 'POST',
    })
    expect(context).toEqual(CONTEXT)
  })

  // Sentry.captureRequestError copies the whole header dict onto the event,
  // which on this app means the tovis_token session cookie. beforeSend would
  // very likely redact it (auditRedaction's JWT pattern matches an `eyJ…`
  // substring), but "a regex probably catches it" is not the standard this repo
  // holds PII to, and the headers buy nothing the path and method do not.
  it('drops request headers so no session cookie reaches Sentry', () => {
    captureRouteRequestError(new Error('boom'), REQUEST, CONTEXT)

    const [, request] = mocks.captureRequestError.mock.calls[0] ?? []
    expect(request?.headers).toEqual({})
    expect(JSON.stringify(request)).not.toContain('tovis_token')
    expect(JSON.stringify(request)).not.toContain('Bearer')
  })
})
