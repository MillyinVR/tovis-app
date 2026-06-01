// sentry.server.config.ts

import * as Sentry from '@sentry/nextjs'

import { redactAuditPayload } from '@/lib/security/auditRedaction'

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN

const DEFAULT_TRACES_SAMPLE_RATE = 0.05

function readTracesSampleRate(): number {
  const parsed = Number(process.env.SENTRY_TRACES_SAMPLE_RATE)

  if (!Number.isFinite(parsed)) return DEFAULT_TRACES_SAMPLE_RATE
  if (parsed < 0) return 0
  if (parsed > 1) return 1

  return parsed
}

function readEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'
}

function scrubSentryEvent<TEvent extends Sentry.Event>(event: TEvent): TEvent {
  const redacted = redactAuditPayload(event)

  if (
    redacted === null ||
    typeof redacted !== 'object' ||
    Array.isArray(redacted)
  ) {
    return event
  }

  return redacted as unknown as TEvent
}

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: readEnvironment(),
  tracesSampleRate: readTracesSampleRate(),

  beforeSend(event) {
    return scrubSentryEvent(event)
  },

  beforeSendTransaction(event) {
    return scrubSentryEvent(event)
  },

  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({
      levels: ['warn', 'error'],
    }),
  ],
})