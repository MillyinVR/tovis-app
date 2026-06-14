// lib/observability/sentryConfig.ts

import * as Sentry from '@sentry/nextjs'

import { isRecord } from '@/lib/guards'
import { redactAuditPayload } from '@/lib/security/auditRedaction'

const DEFAULT_TRACES_SAMPLE_RATE = 0.05
const DEFAULT_PROFILES_SAMPLE_RATE = 0

export function readSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN
}

export function readSentryTracesSampleRate(): number {
  return readClampedRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE ??
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    DEFAULT_TRACES_SAMPLE_RATE,
  )
}

export function readSentryProfilesSampleRate(): number {
  return readClampedRate(
    process.env.SENTRY_PROFILES_SAMPLE_RATE ??
      process.env.NEXT_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE,
    DEFAULT_PROFILES_SAMPLE_RATE,
  )
}

export function readSentryEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ??
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NEXT_PUBLIC_VERCEL_ENV ??
    process.env.NODE_ENV ??
    'development'
  )
}

export function readSentryRelease(): string | undefined {
  return (
    process.env.SENTRY_RELEASE ??
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  )
}

export function readSentryDist(): string | undefined {
  return (
    process.env.SENTRY_DIST ??
    process.env.NEXT_PUBLIC_SENTRY_DIST ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  )
}

export function readSentryEnableLogs(): boolean {
  return readBoolean(
    process.env.SENTRY_ENABLE_LOGS ?? process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS,
    false,
  )
}

export function scrubSentryEvent<TEvent extends Sentry.Event>(event: TEvent): TEvent {
  const redacted = redactAuditPayload(event)

  if (!isRecord(redacted)) {
    return event
  }

  Object.assign(event, redacted)

  return event
}

export function buildSentryConsoleLoggingIntegrations(
  enableLogs: boolean,
): ReturnType<typeof Sentry.consoleLoggingIntegration>[] {
  if (!enableLogs) return []

  return [
    Sentry.consoleLoggingIntegration({
      levels: ['warn', 'error'],
    }),
  ]
}

function readClampedRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0) return 0
  if (parsed > 1) return 1

  return parsed
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase()

  if (!normalized) return fallback

  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}