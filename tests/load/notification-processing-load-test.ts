// tests/load/notification-processing-load-test.ts

import { performance } from 'node:perf_hooks'

type Stage = {
  name: string
  rps: number
  durationSeconds: number
}

type LoadTestProfile = 'smoke' | 'baseline' | 'launch' | 'stress'

type Bucket = 'success' | 'expected401' | 'expected429' | 'realFailure'
type StatusValue = number | 'TIMEOUT' | 'NETWORK'

type RequestRecord = {
  stage: string
  durationMs: number
  status: StatusValue
  code: string | null
  bucket: Bucket
  bodyPreview: string | null
}

type NotificationProcessingConfig = {
  route: string
  method: 'GET' | 'POST'
  take: number
  jobSecret: string
  authMode: 'bearer' | 'header'
}

const STAGE_PROFILES: Record<LoadTestProfile, readonly Stage[]> = {
  smoke: [{ name: 'smoke-1-rps', rps: 1, durationSeconds: 10 }],
  baseline: [
    { name: '2-rps', rps: 2, durationSeconds: 30 },
    { name: '5-rps', rps: 5, durationSeconds: 30 },
  ],
  launch: [
    { name: '5-rps', rps: 5, durationSeconds: 60 },
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '20-rps', rps: 20, durationSeconds: 60 },
  ],
  stress: [
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '25-rps', rps: 25, durationSeconds: 60 },
    { name: '50-rps', rps: 50, durationSeconds: 60 },
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

function methodEnv(name: string, fallback: 'GET' | 'POST'): 'GET' | 'POST' {
  const raw = process.env[name]?.trim().toUpperCase()

  if (!raw) return fallback
  if (raw === 'GET' || raw === 'POST') return raw

  throw new Error(`${name} must be GET or POST.`)
}

function authModeEnv(name: string, fallback: 'bearer' | 'header') {
  const raw = process.env[name]?.trim().toLowerCase()

  if (!raw) return fallback
  if (raw === 'bearer' || raw === 'header') return raw

  throw new Error(`${name} must be bearer or header.`)
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
  if (status === 401) return 'expected401'
  if (status === 429) return 'expected429'

  return 'realFailure'
}

function buildTrustedIp(seq: number, prefix: string): string {
  const thirdOctet = (Math.floor(seq / 254) % 254) + 1
  const fourthOctet = (seq % 254) + 1
  return `${prefix}.${thirdOctet}.${fourthOctet}`
}

function buildHeaders(args: {
  seq: number
  runId: string
  baseUrl: string
  config: NotificationProcessingConfig
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): HeadersInit {
  const origin = new URL(args.baseUrl).origin

  const headers: Record<string, string> = {
    accept: 'application/json',
    origin,
    referer: `${origin}/`,
    'x-request-id': `notification-processing-load-${args.runId}-${args.seq}`,
  }

  if (args.config.authMode === 'bearer') {
    headers.authorization = `Bearer ${args.config.jobSecret}`
  } else {
    headers['x-internal-job-secret'] = args.config.jobSecret
  }

  if (args.trustedHeaderName && args.trustedIpPrefix) {
    headers[args.trustedHeaderName] = buildTrustedIp(
      args.seq,
      args.trustedIpPrefix,
    )
  }

  return headers
}

function buildUrl(args: {
  baseUrl: string
  route: string
  take: number
}): URL {
  const url = new URL(args.route, args.baseUrl)
  url.searchParams.set('take', String(args.take))
  return url
}

async function sendRequest(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  config: NotificationProcessingConfig
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(
      buildUrl({
        baseUrl: args.baseUrl,
        route: args.config.route,
        take: args.config.take,
      }),
      {
        method: args.config.method,
        headers: buildHeaders({
          seq: args.seq,
          runId: args.runId,
          baseUrl: args.baseUrl,
          config: args.config,
          trustedHeaderName: args.trustedHeaderName,
          trustedIpPrefix: args.trustedIpPrefix,
        }),
        signal: controller.signal,
      },
    )

    const bodyText = await response.text().catch(() => '')
    const durationMs = performance.now() - startedAt
    const status = response.status
    const code = parseCode(bodyText)
    const bucket = classifyStatus(status)

    return {
      stage: args.stage.name,
      durationMs,
      status,
      code,
      bucket,
      bodyPreview:
        bucket === 'realFailure' || bucket === 'expected401'
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
  config: NotificationProcessingConfig
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

function buildStageSummary(stageName: string, records: RequestRecord[]) {
  const statusCounts: Record<string, number> = {}
  const codeCounts: Record<string, number> = {}

  for (const record of records) {
    incrementCounter(statusCounts, statusKey(record.status))
    incrementCounter(codeCounts, record.code)
  }

  const nonExpected = records.filter(
    (record) => record.status !== 401 && record.status !== 429,
  )
  const realFailureBase = nonExpected.length
  const realFailureCount = nonExpected.filter(
    (record) => record.bucket === 'realFailure',
  ).length

  return {
    stage: stageName,
    totalRequests: records.length,
    success: records.filter((record) => record.bucket === 'success').length,
    expected401: records.filter((record) => record.status === 401).length,
    expected429: records.filter((record) => record.status === 429).length,
    realFailures: realFailureCount,
    realFailureRateExcludingExpectedPct:
      realFailureBase === 0
        ? null
        : round((realFailureCount / realFailureBase) * 100),
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

function buildSummary(args: {
  runId: string
  baseUrl: string
  profile: LoadTestProfile
  stages: readonly Stage[]
  totalPlannedRequests: number
  config: NotificationProcessingConfig
  records: RequestRecord[]
}) {
  const statusCounts: Record<string, number> = {}
  const codeCounts: Record<string, number> = {}

  for (const record of args.records) {
    incrementCounter(statusCounts, statusKey(record.status))
    incrementCounter(codeCounts, record.code)
  }

  const nonExpected = args.records.filter(
    (record) => record.status !== 401 && record.status !== 429,
  )
  const realFailureBase = nonExpected.length
  const realFailureCount = nonExpected.filter(
    (record) => record.bucket === 'realFailure',
  ).length

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
      take: args.config.take,
      authMode: args.config.authMode,
      hasJobSecret: Boolean(args.config.jobSecret),
    },
    totals: {
      requests: args.records.length,
      success: args.records.filter((record) => record.bucket === 'success')
        .length,
      expected401: args.records.filter((record) => record.status === 401)
        .length,
      expected429: args.records.filter((record) => record.status === 429)
        .length,
      realFailures: realFailureCount,
      realFailureRateExcludingExpectedPct:
        realFailureBase === 0
          ? null
          : round((realFailureCount / realFailureBase) * 100),
    },
    latencyMs: {
      all: summarizeLatency(args.records),
      nonExpected: summarizeLatency(nonExpected),
      successOnly: summarizeLatency(
        args.records.filter((record) => record.bucket === 'success'),
      ),
    },
    statusCounts,
    codeCounts,
    bodyPreviews: collectBodyPreviews(args.records),
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

  const jobSecret =
    optionalEnv('LOAD_TEST_INTERNAL_JOB_SECRET') ??
    optionalEnv('INTERNAL_JOB_SECRET') ??
    optionalEnv('CRON_SECRET')

  if (!jobSecret) {
    throw new Error(
      'LOAD_TEST_INTERNAL_JOB_SECRET, INTERNAL_JOB_SECRET, or CRON_SECRET is required.',
    )
  }

  const config: NotificationProcessingConfig = {
    route:
      optionalEnv('LOAD_TEST_NOTIFICATION_PROCESS_ROUTE') ??
      '/api/internal/jobs/notifications/process',
    method: methodEnv('LOAD_TEST_NOTIFICATION_PROCESS_METHOD', 'POST'),
    take: Math.min(intEnv('LOAD_TEST_NOTIFICATION_PROCESS_TAKE', 100), 250),
    jobSecret,
    authMode: authModeEnv('LOAD_TEST_NOTIFICATION_AUTH_MODE', 'bearer'),
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
          take: config.take,
          authMode: config.authMode,
          hasJobSecret: Boolean(config.jobSecret),
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
      `Starting stage ${stage.name} (${stage.rps} notification processing requests per second for ${stage.durationSeconds}s)...`,
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