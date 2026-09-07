// lib/observability/sentryGate.ts
//
// Decides whether a Sentry SDK instance may report at all.
//
// Every local env file in this repo (.env.local, .env.test.local,
// .env.development.local) carries the LIVE DSN, and NEXT_PUBLIC_SENTRY_DSN is
// inlined into the browser bundle at build time — so a laptop `next dev`,
// `next start`, or Playwright run reports straight into the production Sentry
// project. Every open issue there on 2026-09-07 was `Toris-MacBook-Pro.local`.
// The "blank the DSN on the command line" recipe depends on remembering it;
// this gate does not.
//
// Pure and dependency-free so `instrumentation-client.ts` can import it without
// dragging server-only modules into the client bundle.

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/**
 * True for a hostname that can only be a developer's own machine: `localhost`,
 * any `*.localhost` subdomain, and the loopback IPs.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  return LOOPBACK_HOSTNAMES.has(normalized) || normalized.endsWith('.localhost')
}

/**
 * Report only when there is a DSN AND the process is a deployed runtime — or
 * an operator has opted a local run in explicitly (`SENTRY_ALLOW_LOCAL` on the
 * server, `NEXT_PUBLIC_SENTRY_ALLOW_LOCAL` in the browser).
 */
export function shouldEnableSentry(input: {
  dsn: string | undefined
  onDeployedRuntime: boolean
  allowLocal: boolean
}): boolean {
  if (!input.dsn) return false
  return input.onDeployedRuntime || input.allowLocal
}
