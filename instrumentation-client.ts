// instrumentation-client.ts

import * as Sentry from '@sentry/nextjs'

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

const DEFAULT_TRACES_SAMPLE_RATE = 0.05

function readTracesSampleRate(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)

  if (!Number.isFinite(parsed)) return DEFAULT_TRACES_SAMPLE_RATE
  if (parsed < 0) return 0
  if (parsed > 1) return 1

  return parsed
}

function readEnvironment(): string {
  return process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
}

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: readEnvironment(),
  tracesSampleRate: readTracesSampleRate(),
})