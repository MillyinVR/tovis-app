// tests/load/stripe-webhook-replay-load-test.ts

import { createHmac } from 'node:crypto'
import { performance } from 'node:perf_hooks'

type Stage = {
  name: string
  rps: number
  durationSeconds: number
}

type LoadTestProfile = 'smoke' | 'baseline' | 'launch' | 'stress'

type Bucket = 'success' | 'expected400' | 'expected429' | 'realFailure'
type StatusValue = number | 'TIMEOUT' | 'NETWORK'

type RequestRecord = {
  stage: string
  durationMs: number
  status: StatusValue
  code: string | null
  bucket: Bucket
  duplicate: boolean | null
  handled: boolean | null
  bodyPreview: string | null
}

type StripeWebhookReplayConfig = {
  route: string
  method: 'POST'
  webhookSecret: string
  eventType: string
  replayMode: boolean
  fixedEventId: string | null
  livemode: boolean
  bookingId: string | null
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  accountId: string | null
}

const STAGE_PROFILES: Record<LoadTestProfile, readonly Stage[]> = {
  smoke: [{ name: 'smoke-1-rps', rps: 1, durationSeconds: 10 }],
  baseline: [
    { name: '5-rps', rps: 5, durationSeconds: 30 },
    { name: '10-rps', rps: 10, durationSeconds: 30 },
  ],
  launch: [
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '25-rps', rps: 25, durationSeconds: 60 },
    { name: '50-rps', rps: 50, durationSeconds: 60 },
  ],
  stress: [
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '50-rps', rps: 50, durationSeconds: 60 },
    { name: '100-rps', rps: 100, durationSeconds: 60 },
  ],
} as const

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }

  return parsed
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback

  return raw === '1' || raw === 'true' || raw === 'yes'
}

function loadTestProfileEnv(
  name: string,
  fallback: LoadTestProfile,
): LoadTestProfile {
  const raw = process.env[name]?.trim().toLowerCase()

  if (!raw) return fallback

  if (
    raw === 'smoke' ||
    raw === 'baseline' ||
    raw === 'launch' ||
    raw === 'stress'
  ) {
    return raw
  }

  throw new Error(`${name} must be one of: smoke, baseline, launch, stress.`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )

  return sorted[index] ?? null
}

function round(value: number | null): number | null {
  if (value == null) return null
  return Math.round(value * 100) / 100
}

function readCommitSha(): string | null {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.COMMIT_SHA ??
    null
  )
}

function readEnvironmentName(): string {
  return (
    process.env.LOAD_TEST_ENVIRONMENT ??
    process.env.VERCEL_ENV ??
    process.env.NODE_ENV ??
    'staging'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCode(bodyText: string): string | null {
  if (!bodyText) return null

  try {
    const parsed: unknown = JSON.parse(bodyText)

    if (
      isRecord(parsed) &&
      typeof parsed.code === 'string' &&
      parsed.code.trim()
    ) {
      return parsed.code
    }

    return null
  } catch {
    return null
  }
}

function parseBooleanField(
  source: Record<string, unknown>,
  name: string,
): boolean | null {
  const value = source[name]
  return typeof value === 'boolean' ? value : null
}

function statusKey(status: StatusValue): string {
  return typeof status === 'number' ? String(status) : status
}

function incrementCounter(
  counters: Record<string, number>,
  key: string | null | undefined,
): void {
  if (!key) return
  counters[key] = (counters[key] ?? 0) + 1
}

function classifyStatus(status: StatusValue): Bucket {
  if (status === 200) return 'success'
  if (status === 400) return 'expected400'
  if (status === 429) return 'expected429'

  return 'realFailure'
}

function buildTrustedIp(seq: number, prefix: string): string {
  const thirdOctet = (Math.floor(seq / 254) % 254) + 1
  const fourthOctet = (seq % 254) + 1
  return `${prefix}.${thirdOctet}.${fourthOctet}`
}

function buildRoute(baseUrl: string, route: string): URL {
  return new URL(route, baseUrl)
}

function buildEventId(args: {
  runId: string
  seq: number
  replayMode: boolean
  fixedEventId: string | null
}): string {
  if (args.fixedEventId) return args.fixedEventId
  if (args.replayMode) return `evt_load_replay_${args.runId}`

  return `evt_load_${args.runId}_${args.seq}`
}

function buildStripeObject(args: {
  config: StripeWebhookReplayConfig
  eventId: string
  seq: number
}): Record<string, unknown> {
  const metadata =
    args.config.bookingId || args.config.stripePaymentIntentId
      ? {
          ...(args.config.bookingId ? { bookingId: args.config.bookingId } : {}),
        }
      : {}

  switch (args.config.eventType) {
    case 'checkout.session.completed':
      return {
        id:
          args.config.stripeCheckoutSessionId ??
          `cs_load_${args.eventId}_${args.seq}`,
        object: 'checkout.session',
        client_reference_id: args.config.bookingId,
        metadata,
        payment_intent:
          args.config.stripePaymentIntentId ??
          `pi_load_${args.eventId}_${args.seq}`,
        amount_subtotal: 18000,
        amount_total: 18000,
        currency: 'usd',
      }

    case 'checkout.session.expired':
      return {
        id:
          args.config.stripeCheckoutSessionId ??
          `cs_load_${args.eventId}_${args.seq}`,
        object: 'checkout.session',
        client_reference_id: args.config.bookingId,
        metadata,
        payment_intent:
          args.config.stripePaymentIntentId ??
          `pi_load_${args.eventId}_${args.seq}`,
        amount_subtotal: 18000,
        amount_total: 18000,
        currency: 'usd',
      }

    case 'payment_intent.succeeded':
      return {
        id:
          args.config.stripePaymentIntentId ??
          `pi_load_${args.eventId}_${args.seq}`,
        object: 'payment_intent',
        metadata,
        amount: 18000,
        amount_received: 18000,
        currency: 'usd',
      }

    case 'payment_intent.payment_failed':
      return {
        id:
          args.config.stripePaymentIntentId ??
          `pi_load_${args.eventId}_${args.seq}`,
        object: 'payment_intent',
        metadata,
        amount: 18000,
        amount_received: 0,
        currency: 'usd',
      }

    case 'account.updated':
      return {
        id: args.config.accountId ?? `acct_load_${args.eventId}_${args.seq}`,
        object: 'account',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: {
          currently_due: [],
          eventually_due: [],
          disabled_reason: null,
        },
      }

    default:
      return {
        id: `obj_load_${args.eventId}_${args.seq}`,
        object: 'charge',
        metadata,
        amount: 18000,
        currency: 'usd',
      }
  }
}

function buildStripeEventBody(args: {
  config: StripeWebhookReplayConfig
  runId: string
  seq: number
}): string {
  const eventId = buildEventId({
    runId: args.runId,
    seq: args.seq,
    replayMode: args.config.replayMode,
    fixedEventId: args.config.fixedEventId,
  })

  const event = {
    id: eventId,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: args.config.livemode,
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: args.config.eventType,
    data: {
      object: buildStripeObject({
        config: args.config,
        eventId,
        seq: args.seq,
      }),
    },
  }

  return JSON.stringify(event)
}

function signStripePayload(args: {
  payload: string
  webhookSecret: string
  timestamp: number
}): string {
  const signedPayload = `${args.timestamp}.${args.payload}`
  const signature = createHmac('sha256', args.webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  return `t=${args.timestamp},v1=${signature}`
}

function buildHeaders(args: {
  seq: number
  runId: string
  baseUrl: string
  payload: string
  webhookSecret: string
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): HeadersInit {
  const origin = new URL(args.baseUrl).origin
  const timestamp = Math.floor(Date.now() / 1000)

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    origin,
    referer: `${origin}/`,
    'stripe-signature': signStripePayload({
      payload: args.payload,
      webhookSecret: args.webhookSecret,
      timestamp,
    }),
    'x-request-id': `stripe-webhook-load-${args.runId}-${args.seq}`,
  }

  if (args.trustedHeaderName && args.trustedIpPrefix) {
    headers[args.trustedHeaderName] = buildTrustedIp(
      args.seq,
      args.trustedIpPrefix,
    )
  }

  return headers
}

async function sendRequest(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  config: StripeWebhookReplayConfig
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()
  const payload = buildStripeEventBody({
    config: args.config,
    runId: args.runId,
    seq: args.seq,
  })

  try {
    const response = await fetch(buildRoute(args.baseUrl, args.config.route), {
      method: args.config.method,
      headers: buildHeaders({
        seq: args.seq,
        runId: args.runId,
        baseUrl: args.baseUrl,
        payload,
        webhookSecret: args.config.webhookSecret,
        trustedHeaderName: args.trustedHeaderName,
        trustedIpPrefix: args.trustedIpPrefix,
      }),
      body: payload,
      signal: controller.signal,
    })

    const bodyText = await response.text().catch(() => '')
    const durationMs = performance.now() - startedAt
    const status = response.status
    const code = parseCode(bodyText)
    const bucket = classifyStatus(status)

    let duplicate: boolean | null = null
    let handled: boolean | null = null

    try {
      const parsed: unknown = JSON.parse(bodyText)
      if (isRecord(parsed)) {
        duplicate = parseBooleanField(parsed, 'duplicate')
        handled = parseBooleanField(parsed, 'handled')
      }
    } catch {
      // Summary keeps bodyPreview for failures.
    }

    return {
      stage: args.stage.name,
      durationMs,
      status,
      code,
      bucket,
      duplicate,
      handled,
      bodyPreview:
        bucket === 'realFailure' || bucket === 'expected400'
          ? bodyText.slice(0, 500) || null
          : null,
    }
  } catch (error) {
    const durationMs = performance.now() - startedAt
    const status: StatusValue =
      error instanceof Error && error.name === 'AbortError'
        ? 'TIMEOUT'
        : 'NETWORK'

    return {
      stage: args.stage.name,
      durationMs,
      status,
      code: null,
      bucket: 'realFailure',
      duplicate: null,
      handled: null,
      bodyPreview: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function runStage(args: {
  stage: Stage
  startSeq: number
  runId: string
  baseUrl: string
  config: StripeWebhookReplayConfig
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
  maxInFlight: number
  records: RequestRecord[]
}): Promise<number> {
  const totalRequests = args.stage.rps * args.stage.durationSeconds
  const startedAt = performance.now()

  let launched = 0
  let nextSeq = args.startSeq

  const inFlight = new Set<Promise<void>>()

  while (launched < totalRequests) {
    const elapsedSeconds = (performance.now() - startedAt) / 1000
    const shouldHaveLaunched = Math.min(
      totalRequests,
      Math.floor(elapsedSeconds * args.stage.rps),
    )

    while (launched < shouldHaveLaunched) {
      while (inFlight.size >= args.maxInFlight) {
        await sleep(5)
      }

      const seq = nextSeq
      nextSeq += 1
      launched += 1

      const task = sendRequest({
        stage: args.stage,
        seq,
        runId: args.runId,
        baseUrl: args.baseUrl,
        config: args.config,
        requestTimeoutMs: args.requestTimeoutMs,
        trustedHeaderName: args.trustedHeaderName,
        trustedIpPrefix: args.trustedIpPrefix,
      })
        .then((record) => {
          args.records.push(record)
        })
        .finally(() => {
          inFlight.delete(task)
        })

      inFlight.add(task)
    }

    await sleep(5)
  }

  await Promise.all(inFlight)
  return nextSeq
}

function summarizeLatency(records: RequestRecord[]) {
  const values = records.map((record) => record.durationMs)

  return {
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
  }
}

function collectBodyPreviews(records: RequestRecord[]): string[] {
  return records
    .map((record) => record.bodyPreview)
    .filter((preview): preview is string => Boolean(preview))
    .slice(0, 10)
}

function buildRecordSummary(records: RequestRecord[]) {
  const statusCounts: Record<string, number> = {}
  const codeCounts: Record<string, number> = {}

  for (const record of records) {
    incrementCounter(statusCounts, statusKey(record.status))
    incrementCounter(codeCounts, record.code)
  }

  const nonExpected = records.filter(
    (record) => record.status !== 400 && record.status !== 429,
  )

  const realFailureBase = nonExpected.length
  const realFailureCount = nonExpected.filter(
    (record) => record.bucket === 'realFailure',
  ).length

  return {
    totalRequests: records.length,
    success: records.filter((record) => record.bucket === 'success').length,
    expected400: records.filter((record) => record.status === 400).length,
    expected429: records.filter((record) => record.status === 429).length,
    realFailures: realFailureCount,
    realFailureRateExcludingExpectedPct:
      realFailureBase === 0
        ? null
        : round((realFailureCount / realFailureBase) * 100),
    duplicates: records.filter((record) => record.duplicate === true).length,
    handled: records.filter((record) => record.handled === true).length,
    unhandled: records.filter((record) => record.handled === false).length,
    latencyMs: {
      all: summarizeLatency(records),
      nonExpected: summarizeLatency(nonExpected),
      successOnly: summarizeLatency(
        records.filter((record) => record.bucket === 'success'),
      ),
    },
    statusCounts,
    codeCounts,
    bodyPreviews: collectBodyPreviews(records),
  }
}

function buildStageSummary(stageName: string, records: RequestRecord[]) {
  return {
    stage: stageName,
    ...buildRecordSummary(records),
  }
}

function buildSummary(args: {
  runId: string
  baseUrl: string
  profile: LoadTestProfile
  stages: readonly Stage[]
  totalPlannedRequests: number
  config: StripeWebhookReplayConfig
  records: RequestRecord[]
}) {
  return {
    runId: args.runId,
    commit: readCommitSha(),
    environment: readEnvironmentName(),
    baseUrl: args.baseUrl,
    route: `${args.config.method} ${args.config.route}`,
    profile: args.profile,
    trafficPlan: args.stages,
    totalPlannedRequests: args.totalPlannedRequests,
    config: {
      route: args.config.route,
      method: args.config.method,
      eventType: args.config.eventType,
      replayMode: args.config.replayMode,
      fixedEventId: args.config.fixedEventId,
      livemode: args.config.livemode,
      hasWebhookSecret: Boolean(args.config.webhookSecret),
      bookingId: args.config.bookingId,
      stripeCheckoutSessionId: args.config.stripeCheckoutSessionId,
      stripePaymentIntentId: args.config.stripePaymentIntentId,
      accountId: args.config.accountId,
    },
    totals: buildRecordSummary(args.records),
    perStage: args.stages.map((stage) =>
      buildStageSummary(
        stage.name,
        args.records.filter((record) => record.stage === stage.name),
      ),
    ),
  }
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('STAGING_BASE_URL').replace(/\/+$/, '')
  const profile = loadTestProfileEnv('LOAD_TEST_PROFILE', 'smoke')
  const stages = STAGE_PROFILES[profile]

  const config: StripeWebhookReplayConfig = {
    route: optionalEnv('LOAD_TEST_STRIPE_WEBHOOK_ROUTE') ?? '/api/webhooks/stripe',
    method: 'POST',
    webhookSecret: requireEnv('STRIPE_WEBHOOK_SECRET'),
    eventType: optionalEnv('LOAD_TEST_STRIPE_EVENT_TYPE') ?? 'charge.succeeded',
    replayMode: boolEnv('LOAD_TEST_STRIPE_REPLAY_MODE', true),
    fixedEventId: optionalEnv('LOAD_TEST_STRIPE_EVENT_ID'),
    livemode: boolEnv('LOAD_TEST_STRIPE_LIVEMODE', false),
    bookingId: optionalEnv('LOAD_TEST_BOOKING_ID'),
    stripeCheckoutSessionId: optionalEnv('LOAD_TEST_STRIPE_CHECKOUT_SESSION_ID'),
    stripePaymentIntentId: optionalEnv('LOAD_TEST_STRIPE_PAYMENT_INTENT_ID'),
    accountId: optionalEnv('LOAD_TEST_STRIPE_ACCOUNT_ID'),
  }

  const trustedHeaderName = optionalEnv('LOAD_TEST_TRUSTED_IP_HEADER_NAME')
  const trustedIpPrefix = optionalEnv('LOAD_TEST_TRUSTED_IP_PREFIX')

  if (
    (trustedHeaderName && !trustedIpPrefix) ||
    (!trustedHeaderName && trustedIpPrefix)
  ) {
    throw new Error(
      'LOAD_TEST_TRUSTED_IP_HEADER_NAME and LOAD_TEST_TRUSTED_IP_PREFIX must be set together.',
    )
  }

  const requestTimeoutMs = intEnv('LOAD_TEST_REQUEST_TIMEOUT_MS', 15000)
  const maxInFlight = intEnv('LOAD_TEST_MAX_IN_FLIGHT', 2000)

  const totalPlannedRequests = stages.reduce(
    (total, stage) => total + stage.rps * stage.durationSeconds,
    0,
  )

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '')

  const records: RequestRecord[] = []
  let nextSeq = 1

  console.log(
    JSON.stringify(
      {
        runId,
        commit: readCommitSha(),
        environment: readEnvironmentName(),
        baseUrl,
        route: `${config.method} ${config.route}`,
        profile,
        trafficPlan: stages,
        totalPlannedRequests,
        requestTimeoutMs,
        maxInFlight,
        config: {
          route: config.route,
          method: config.method,
          eventType: config.eventType,
          replayMode: config.replayMode,
          fixedEventId: config.fixedEventId,
          livemode: config.livemode,
          hasWebhookSecret: Boolean(config.webhookSecret),
          bookingId: config.bookingId,
          stripeCheckoutSessionId: config.stripeCheckoutSessionId,
          stripePaymentIntentId: config.stripePaymentIntentId,
          accountId: config.accountId,
        },
        usingSyntheticTrustedIpHeader: Boolean(
          trustedHeaderName && trustedIpPrefix,
        ),
      },
      null,
      2,
    ),
  )

  for (const stage of stages) {
    console.log(
      `Starting stage ${stage.name} (${stage.rps} Stripe webhook requests per second for ${stage.durationSeconds}s)...`,
    )

    nextSeq = await runStage({
      stage,
      startSeq: nextSeq,
      runId,
      baseUrl,
      config,
      requestTimeoutMs,
      trustedHeaderName,
      trustedIpPrefix,
      maxInFlight,
      records,
    })
  }

  const summary = buildSummary({
    runId,
    baseUrl,
    profile,
    stages,
    totalPlannedRequests,
    config,
    records,
  })

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})