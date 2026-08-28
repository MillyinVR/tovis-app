// lib/observability/requestErrors.ts
//
// The `onRequestError` instrumentation hook. This is the only thing that puts
// an UNHANDLED server error — from a route handler, a server component, or a
// server action — into Sentry.
//
// Why it had to be added: @sentry/nextjs has two ways to see a server error,
// and this app had neither.
//   1. Build-time wrapping. `withSentryConfig` injects `wrappingLoader` only
//      through its WEBPACK config (build/cjs/config/webpack.js); the Turbopack
//      path (build/cjs/config/turbopack/*) does value injection ONLY. Next 16
//      defaults to Turbopack when no bundler flag is set
//      (next/dist/lib/bundler.js: "The default is turbopack when nothing is
//      configured"), and package.json's build script passes no flag and
//      next.config.ts sets no `webpack` key. Proof, not inference: in the
//      committed build output, 0 of 436 built `route.js` files contain
//      `wrapRouteHandlerWithSentry`.
//   2. This hook. It was not exported. The SDK even warns about that
//      ("Could not find `onRequestError` hook in instrumentation file") — but
//      that warning also lives in webpack.js, so under Turbopack nobody is told.
//
// The consequence was that a route handler which rethrows after logging reached
// Sentry no more reliably than one that swallows: console output only reaches
// Sentry through consoleLoggingIntegration, gated on SENTRY_ENABLE_LOGS, which
// is deliberately OFF by default as a PII control
// (docs/reference/launch-readiness/risk-register.md). Every server error was
// visible only in the raw Vercel runtime log.
//
// Headers are dropped on purpose. Sentry.captureRequestError copies the whole
// request header dict onto the event, which on this app means the `tovis_token`
// session cookie. `beforeSend: scrubSentryEvent` would very likely redact it —
// the JWT pattern in auditRedaction.ts matches an `eyJ…` substring — but
// "a regex probably catches it" is not the standard this repo holds PII to, and
// the headers buy nothing the route path and method do not already give. Method,
// path, router kind, route path and route type are all preserved.
//
// The error itself is passed through UNSANITIZED, unlike the capture* helpers
// that rebuild it from safeError(). That is deliberate: those helpers throw the
// stack away, and for an unhandled error the stack is the whole point. It is
// safe because every string on the event — message and stack frames included —
// goes through `beforeSend: scrubSentryEvent` -> redactAuditPayload, which
// applies the same key AND content patterns (token, JWT, email, phone, signed
// URL, private media path) that safeError applies. Same trade
// captureBookingException already makes.

import * as Sentry from '@sentry/nextjs'

type CaptureRequestErrorArgs = Parameters<typeof Sentry.captureRequestError>

/**
 * Next.js `onRequestError` hook. Re-exported from instrumentation.ts, which is
 * the only place Next.js reads it from.
 */
export function captureRouteRequestError(
  error: CaptureRequestErrorArgs[0],
  request: CaptureRequestErrorArgs[1],
  errorContext: CaptureRequestErrorArgs[2],
): void {
  Sentry.captureRequestError(
    error,
    { path: request.path, method: request.method, headers: {} },
    errorContext,
  )
}
