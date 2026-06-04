// tests/load/media-metadata-load-test.ts

import { Buffer } from 'node:buffer'
import { performance } from 'node:perf_hooks'

import { createClient } from '@supabase/supabase-js'

type Stage = {
  name: string
  rps: number
  durationSeconds: number
}

type LoadTestProfile = 'smoke' | 'baseline' | 'launch' | 'stress'

type Bucket = 'success' | 'expected409' | 'expected429' | 'realFailure'
type StatusValue = number | 'TIMEOUT' | 'NETWORK'

type RequestRecord = {
  stage: string
  durationMs: number
  status: StatusValue
  code: string | null
  bucket: Bucket
  bodyPreview: string | null
}

type MediaMetadataLoadConfig = {
  bookingId: string
  professionalId: string | null
  proCookie: string
  mediaRouteTemplate: string
  mediaType: string
  phase: string
  visibility: string
  storageBucket: string
  storagePathPrefix: string
  publicUrlPrefix: string | null
  thumbBucket: string | null
  thumbPathPrefix: string | null
  thumbUrlPrefix: string | null
  captionPrefix: string
  supabaseUrl: string
  supabaseServiceRoleKey: string
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

const ONE_PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/AsP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ISP/2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z',
  'base64',
)

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
  if (status === 200 || status === 201) return 'success'
  if (status === 409) return 'expected409'
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
  proCookie: string
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): HeadersInit {
  const origin = new URL(args.baseUrl).origin

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    cookie: args.proCookie,
    origin,
    referer: `${origin}/`,
    'idempotency-key': `media-metadata-load-${args.runId}-${args.seq}`,
  }

  if (args.trustedHeaderName && args.trustedIpPrefix) {
    headers[args.trustedHeaderName] = buildTrustedIp(
      args.seq,
      args.trustedIpPrefix,
    )
  }

  return headers
}

function buildRoute(args: {
  baseUrl: string
  routeTemplate: string
  bookingId: string
}): URL {
  const route = args.routeTemplate.replace(':bookingId', args.bookingId)
  return new URL(route, args.baseUrl)
}

function phasePathSegment(phase: string): string {
  return phase.trim().toLowerCase()
}

function buildStoragePath(args: {
  prefix: string
  runId: string
  seq: number
}): string {
  const normalizedPrefix = args.prefix.replace(/^\/+|\/+$/g, '')
  return `${normalizedPrefix}/${args.runId}/media-${args.seq}.jpg`
}

function buildOptionalUrl(args: {
  prefix: string | null
  path: string
}): string | null {
  if (!args.prefix) return null

  const normalizedPrefix = args.prefix.replace(/\/+$/g, '')
  const normalizedPath = args.path.replace(/^\/+/g, '')

  return `${normalizedPrefix}/${normalizedPath}`
}

function buildPayload(args: {
  config: MediaMetadataLoadConfig
  runId: string
  seq: number
}) {
  const storagePath = buildStoragePath({
    prefix: args.config.storagePathPrefix,
    runId: args.runId,
    seq: args.seq,
  })

  const thumbPath = args.config.thumbPathPrefix
    ? buildStoragePath({
        prefix: args.config.thumbPathPrefix,
        runId: args.runId,
        seq: args.seq,
      })
    : null

  const url = buildOptionalUrl({
    prefix: args.config.publicUrlPrefix,
    path: storagePath,
  })

  const thumbUrl = thumbPath
    ? buildOptionalUrl({
        prefix: args.config.thumbUrlPrefix,
        path: thumbPath,
      })
    : null

  return {
    mediaType: args.config.mediaType,
    phase: args.config.phase,
    visibility: args.config.visibility,
    caption: `${args.config.captionPrefix} ${args.runId}-${args.seq}`,
    url,
    thumbUrl,
    storageBucket: args.config.storageBucket,
    storagePath,
    thumbBucket: args.config.thumbBucket,
    thumbPath,
  }
}

async function uploadStorageObject(args: {
  config: MediaMetadataLoadConfig
  storagePath: string
}): Promise<void> {
  const supabase = createClient(
    args.config.supabaseUrl,
    args.config.supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )

  const { error } = await supabase.storage
    .from(args.config.storageBucket)
    .upload(args.storagePath, ONE_PIXEL_JPEG, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (error) {
    throw new Error(
      `Failed to upload storage object ${args.config.storageBucket}/${args.storagePath}: ${error.message}`,
    )
  }
}

async function sendRequest(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  config: MediaMetadataLoadConfig
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()

  const payload = buildPayload({
    config: args.config,
    runId: args.runId,
    seq: args.seq,
  })

  if (
    !isRecord(payload) ||
    typeof payload.storagePath !== 'string' ||
    !payload.storagePath
  ) {
    throw new Error('Media metadata payload did not include a storagePath.')
  }

  try {
    await uploadStorageObject({
      config: args.config,
      storagePath: payload.storagePath,
    })
    const response = await fetch(
      buildRoute({
        baseUrl: args.baseUrl,
        routeTemplate: args.config.mediaRouteTemplate,
        bookingId: args.config.bookingId,
      }),
      {
        method: 'POST',
        headers: buildHeaders({
          seq: args.seq,
          runId: args.runId,
          baseUrl: args.baseUrl,
          proCookie: args.config.proCookie,
          trustedHeaderName: args.trustedHeaderName,
          trustedIpPrefix: args.trustedIpPrefix,
        }),
        body: JSON.stringify(payload),
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
        bucket === 'realFailure' ? bodyText.slice(0, 500) || null : null,
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
  config: MediaMetadataLoadConfig
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
    (record) => record.status !== 409 && record.status !== 429,
  )
  const realFailureBase = nonExpected.length
  const realFailureCount = nonExpected.filter(
    (record) => record.bucket === 'realFailure',
  ).length

  return {
    stage: stageName,
    totalRequests: records.length,
    success: records.filter((record) => record.bucket === 'success').length,
    expected409: records.filter((record) => record.status === 409).length,
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
  config: MediaMetadataLoadConfig
  records: RequestRecord[]
}) {
  const statusCounts: Record<string, number> = {}
  const codeCounts: Record<string, number> = {}

  for (const record of args.records) {
    incrementCounter(statusCounts, statusKey(record.status))
    incrementCounter(codeCounts, record.code)
  }

  const nonExpected = args.records.filter(
    (record) => record.status !== 409 && record.status !== 429,
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
    route: `POST ${args.config.mediaRouteTemplate}`,
    profile: args.profile,
    trafficPlan: args.stages,
    totalPlannedRequests: args.totalPlannedRequests,
    config: {
      bookingId: args.config.bookingId,
      professionalId: args.config.professionalId,
      mediaRouteTemplate: args.config.mediaRouteTemplate,
      mediaType: args.config.mediaType,
      phase: args.config.phase,
      visibility: args.config.visibility,
      storageBucket: args.config.storageBucket,
      storagePathPrefix: args.config.storagePathPrefix,
      hasProCookie: Boolean(args.config.proCookie),
    },
    totals: {
      requests: args.records.length,
      success: args.records.filter((record) => record.bucket === 'success')
        .length,
      expected409: args.records.filter((record) => record.status === 409)
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

  const bookingId = requireEnv('LOAD_TEST_BOOKING_ID')
  const mediaPhase = optionalEnv('LOAD_TEST_MEDIA_PHASE') ?? 'AFTER'

  const config: MediaMetadataLoadConfig = {
    bookingId,
    professionalId: optionalEnv('LOAD_TEST_PROFESSIONAL_ID'),
    proCookie: requireEnv('LOAD_TEST_PRO_COOKIE'),
    mediaRouteTemplate:
      optionalEnv('LOAD_TEST_MEDIA_ROUTE_TEMPLATE') ??
      '/api/pro/bookings/:bookingId/media',
    mediaType: optionalEnv('LOAD_TEST_MEDIA_TYPE') ?? 'IMAGE',
    phase: mediaPhase,
    visibility: optionalEnv('LOAD_TEST_MEDIA_VISIBILITY') ?? 'PRO_CLIENT',
    storageBucket: optionalEnv('LOAD_TEST_STORAGE_BUCKET') ?? 'media-private',
    storagePathPrefix:
      optionalEnv('LOAD_TEST_STORAGE_PATH_PREFIX') ??
      `bookings/${bookingId}/${phasePathSegment(mediaPhase)}`,
    publicUrlPrefix: optionalEnv('LOAD_TEST_PUBLIC_URL_PREFIX'),
    thumbBucket: optionalEnv('LOAD_TEST_THUMB_BUCKET'),
    thumbPathPrefix: optionalEnv('LOAD_TEST_THUMB_PATH_PREFIX'),
    thumbUrlPrefix: optionalEnv('LOAD_TEST_THUMB_URL_PREFIX'),
    captionPrefix:
      optionalEnv('LOAD_TEST_MEDIA_CAPTION_PREFIX') ??
      'Load test media metadata',
    supabaseUrl: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
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
        route: `POST ${config.mediaRouteTemplate}`,
        profile,
        trafficPlan: stages,
        totalPlannedRequests,
        requestTimeoutMs,
        maxInFlight,
        config: {
          bookingId: config.bookingId,
          professionalId: config.professionalId,
          mediaRouteTemplate: config.mediaRouteTemplate,
          mediaType: config.mediaType,
          phase: config.phase,
          visibility: config.visibility,
          storageBucket: config.storageBucket,
          storagePathPrefix: config.storagePathPrefix,
          hasProCookie: Boolean(config.proCookie),
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
      `Starting stage ${stage.name} (${stage.rps} media metadata requests per second for ${stage.durationSeconds}s)...`,
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