// instrumentation-client.ts

import * as Sentry from '@sentry/nextjs'

import { parseEnvFlag } from '@/lib/env'
import {
  isLoopbackHostname,
  shouldEnableSentry,
} from '@/lib/observability/sentryGate'

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

const DEFAULT_TRACES_SAMPLE_RATE = 0.05

function readClampedRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0) return 0
  if (parsed > 1) return 1

  return parsed
}

function readEnvironment(): string {
  return (
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  )
}

function readRelease(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  )
}

function readDist(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SENTRY_DIST ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  )
}

// The browser has no VERCEL_ENV; a loopback hostname is the one signal that
// cannot be a deployment. Vercel previews and prod always serve on a real host.
function isDeployedOrigin(): boolean {
  if (typeof window === 'undefined') return false
  return !isLoopbackHostname(window.location.hostname)
}

Sentry.init({
  dsn,
  enabled: shouldEnableSentry({
    dsn,
    onDeployedRuntime: isDeployedOrigin(),
    // Literal reference on purpose — Next inlines NEXT_PUBLIC_* by name only.
    allowLocal: parseEnvFlag(process.env.NEXT_PUBLIC_SENTRY_ALLOW_LOCAL),
  }),
  environment: readEnvironment(),
  release: readRelease(),
  dist: readDist(),
  tracesSampleRate: readClampedRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
  ),
})