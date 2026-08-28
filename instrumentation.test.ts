// instrumentation.test.ts
//
// Guards the wiring, not the behaviour. `onRequestError` is the ONLY thing that
// puts an unhandled server error into Sentry in this app, and it is wired by
// nothing more than the presence of an export with that exact name in this
// exact file — so a rename, a refactor, or a merge that drops the re-export
// takes every server error alarm down without failing a single other test.
//
// Why it is the only thing: @sentry/nextjs' other route into server errors is
// the build-time wrapping loader, which withSentryConfig installs only on its
// WEBPACK path, and this app builds with Turbopack (Next 16's default, and
// package.json passes no bundler flag). Next's own app-route build template
// calls `routeModule.onRequestError(...)` on a thrown handler error, which
// loads THIS module and calls the export below.

import { describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/nextjs', () => ({
  captureRequestError: vi.fn(),
}))

import * as instrumentation from './instrumentation'
import { captureRouteRequestError } from '@/lib/observability/requestErrors'

describe('instrumentation.ts', () => {
  it('exports onRequestError under the exact name Next.js looks for', () => {
    expect(typeof instrumentation.onRequestError).toBe('function')
  })

  it('points onRequestError at the redacting wrapper, not the raw SDK export', () => {
    expect(instrumentation.onRequestError).toBe(captureRouteRequestError)
  })

  it('still exports register', () => {
    expect(typeof instrumentation.register).toBe('function')
  })
})
