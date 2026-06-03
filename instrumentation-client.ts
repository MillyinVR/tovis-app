// instrumentation-client.ts

import * as Sentry from '@sentry/nextjs'

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

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: readEnvironment(),
  release: readRelease(),
  dist: readDist(),
  tracesSampleRate: readClampedRate(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
  ),
})