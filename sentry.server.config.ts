// sentry.server.config.ts

import * as Sentry from '@sentry/nextjs'

import {
  buildSentryConsoleLoggingIntegrations,
  readSentryDist,
  readSentryDsn,
  readSentryEnableLogs,
  readSentryEnvironment,
  readSentryProfilesSampleRate,
  readSentryRelease,
  readSentryTracesSampleRate,
  scrubSentryEvent,
} from '@/lib/observability/sentryConfig'

const dsn = readSentryDsn()
const enableLogs = readSentryEnableLogs()

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: readSentryEnvironment(),
  release: readSentryRelease(),
  dist: readSentryDist(),
  tracesSampleRate: readSentryTracesSampleRate(),
  profilesSampleRate: readSentryProfilesSampleRate(),

  beforeSend(event) {
    return scrubSentryEvent(event)
  },

  beforeSendTransaction(event) {
    return scrubSentryEvent(event)
  },

  enableLogs,
  integrations: buildSentryConsoleLoggingIntegrations(enableLogs),
})