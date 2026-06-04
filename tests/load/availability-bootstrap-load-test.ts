import { performance } from 'node:perf_hooks'

type Stage = {
  name: string
  rps: number
  durationSeconds: number
}

type LoadTestProfile = 'smoke' | 'baseline' | 'launch' | 'stress'
type Bucket = 'success' | 'expected429' | 'realFailure'
type StatusValue = number | 'TIMEOUT' | 'NETWORK'

type RequestRecord = {
  stage: string
  durationMs: number
  status: StatusValue
  code: string | null
  bucket: Bucket
}

type AvailabilityBootstrapConfig = {
  professionalId: string
  serviceId: string
  mediaId: string | null
  locationType: string | null
  locationId: string | null
  clientAddressId: string | null
  addOnIds: string[]
  startDate: string | null
  days: number
  includeOtherPros: boolean
  debug: boolean
  viewerLat: number | null
  viewerLng: number | null
  radiusMiles: number | null
  stepMinutes: number | null
  leadMinutes: number | null
}

const STAGE_PROFILES: Record<LoadTestProfile, readonly Stage[]> = {
  smoke: [{ name: 'smoke-1-rps', rps: 1, durationSeconds: 30 }],
  baseline: [
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '25-rps', rps: 25, durationSeconds: 60 },
  ],
  launch: [
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '50-rps', rps: 50, durationSeconds: 60 },
    { name: '100-rps', rps: 100, durationSeconds: 60 },
  ],
  stress: [
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '50-rps', rps: 50, durationSeconds: 60 },
    { name: '100-rps', rps: 100, durationSeconds: 60 },
    { name: '200-rps', rps: 200, durationSeconds: 120 },
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

function optionalIntEnv(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be an integer.`)
  }

  return parsed
}

function optionalFloatEnv(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null

  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number.`)
  }

  return parsed
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function csvEnv(name: string): string[] {
  const raw = process.env[name]?.trim()
  if (!raw) return []

  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
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

function buildTrustedIp(seq: number, prefix: string): string {
  const thirdOctet = (Math.floor(seq / 254) % 254) + 1
  const fourthOctet = (seq % 254) + 1
  return `${prefix}.${thirdOctet}.${fourthOctet}`
}

function buildHeaders(
  seq: number,
  trustedHeaderName: string | null,
  trustedIpPrefix: string | null,
): HeadersInit {
  const headers: Record<string, string> = {
    accept: 'application/json',
  }

  if (trustedHeaderName && trustedIpPrefix) {
    headers[trustedHeaderName] = buildTrustedIp(seq, trustedIpPrefix)
  }

  return headers
}

function appendOptionalParam(
  searchParams: URLSearchParams,
  name: string,
  value: string | number | boolean | null,
): void {
  if (value == null) return
  searchParams.set(name, String(value))
}

function buildUrl(baseUrl: string, config: AvailabilityBootstrapConfig): string {
  const url = new URL('/api/availability/bootstrap', baseUrl)

  url.searchParams.set('professionalId', config.professionalId)
  url.searchParams.set('serviceId', config.serviceId)
  url.searchParams.set('days', String(config.days))
  url.searchParams.set('includeOtherPros', config.includeOtherPros ? '1' : '0')

  appendOptionalParam(url.searchParams, 'mediaId', config.mediaId)
  appendOptionalParam(url.searchParams, 'locationType', config.locationType)
  appendOptionalParam(url.searchParams, 'locationId', config.locationId)
  appendOptionalParam(
    url.searchParams,
    'clientAddressId',
    config.clientAddressId,
  )
  appendOptionalParam(url.searchParams, 'startDate', config.startDate)
  appendOptionalParam(url.searchParams, 'viewerLat', config.viewerLat)
  appendOptionalParam(url.searchParams, 'viewerLng', config.viewerLng)
  appendOptionalParam(url.searchParams, 'radiusMiles', config.radiusMiles)
  appendOptionalParam(url.searchParams, 'stepMinutes', config.stepMinutes)
  appendOptionalParam(url.searchParams, 'leadMinutes', config.leadMinutes)

  if (config.addOnIds.length > 0) {
    url.searchParams.set('addOnIds', config.addOnIds.join(','))
  }

  if (config.debug) {
    url.searchParams.set('debug', '1')
  }

  return url.toString()
}

function redactUrlForSummary(url: string): string {
  const parsed = new URL(url)

  const allowedParams = new Set([
    'professionalId',
    'serviceId',
    'mediaId',
    'locationType',
    'locationId',
    'clientAddressId',
    'addOnIds',
    'startDate',
    'days',
    'includeOtherPros',
    'debug',
    'viewerLat',
    'viewerLng',
    'radiusMiles',
    'stepMinutes',
    'leadMinutes',
  ])

  for (const key of [...parsed.searchParams.keys()]) {
    if (!allowedParams.has(key)) {
      parsed.searchParams.set(key, '[redacted]')
    }
  }

  return parsed.toString()
}

function classifyStatus(status: StatusValue): Bucket {
  if (status === 200) return 'success'
  if (status === 429) return 'expected429'
  return 'realFailure'
}

function parseCode(bodyText: string): string | null {
  if (!bodyText) return null

  try {
    const parsed: unknown = JSON.parse(bodyText)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      typeof parsed.code === 'string'
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

async function sendRequest(args: {
  stage: Stage
  seq: number
  url: string
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(args.url, {
      method: 'GET',
      headers: buildHeaders(
        args.seq,
        args.trustedHeaderName,
        args.trustedIpPrefix,
      ),
      signal: controller.signal,
    })

    const bodyText = await response.text().catch(() => '')
    const durationMs = performance.now() - startedAt
    const status = response.status
    const code = parseCode(bodyText)

    return {
      stage: args.stage.name,
      durationMs,
      status,
      code,
      bucket: classifyStatus(status),
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
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function runStage(args: {
  stage: Stage
  startSeq: number
  url: string
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
        url: args.url,
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

function buildStageSummary(stageName: string, records: RequestRecord[]) {
  const statusCounts: Record<string, number> = {}
  const codeCounts: Record<string, number> = {}

  for (const record of records) {
    incrementCounter(statusCounts, statusKey(record.status))
    incrementCounter(codeCounts, record.code)
  }

  const non429 = records.filter((record) => record.status !== 429)
  const realFailureBase = non429.length
  const realFailureCount = non429.filter(
    (record) => record.bucket === 'realFailure',
  ).length

  return {
    stage: stageName,
    totalRequests: records.length,
    success200: records.filter((record) => record.status === 200).length,
    expected429: records.filter((record) => record.status === 429).length,
    realFailures: realFailureCount,
    realFailureRateExcluding429Pct:
      realFailureBase === 0
        ? null
        : round((realFailureCount / realFailureBase) * 100),
    latencyMs: {
      all: summarizeLatency(records),
      non429: summarizeLatency(non429),
      successOnly: summarizeLatency(
        records.filter((record) => record.status === 200),
      ),
    },
    statusCounts,
    codeCounts,
  }
}

function buildSummary(args: {
  runId: string
  baseUrl: string
  url: string
  profile: LoadTestProfile
  stages: readonly Stage[]
  totalPlannedRequests: number
  config: AvailabilityBootstrapConfig
  records: RequestRecord[]
}) {
  const statusCounts: Record<string, number> = {}
  const codeCounts: Record<string, number> = {}

  for (const record of args.records) {
    incrementCounter(statusCounts, statusKey(record.status))
    incrementCounter(codeCounts, record.code)
  }

  const non429 = args.records.filter((record) => record.status !== 429)
  const realFailureBase = non429.length
  const realFailureCount = non429.filter(
    (record) => record.bucket === 'realFailure',
  ).length

  return {
    runId: args.runId,
    commit: readCommitSha(),
    environment: readEnvironmentName(),
    baseUrl: args.baseUrl,
    route: 'GET /api/availability/bootstrap',
    config: {
      professionalId: args.config.professionalId,
      serviceId: args.config.serviceId,
      mediaId: args.config.mediaId,
      locationType: args.config.locationType,
      locationId: args.config.locationId,
      clientAddressId: args.config.clientAddressId,
      addOnIds: args.config.addOnIds,
      startDate: args.config.startDate,
      days: args.config.days,
      includeOtherPros: args.config.includeOtherPros,
      debug: args.config.debug,
      viewerLat: args.config.viewerLat,
      viewerLng: args.config.viewerLng,
      radiusMiles: args.config.radiusMiles,
      stepMinutes: args.config.stepMinutes,
      leadMinutes: args.config.leadMinutes,
    },
    profile: args.profile,
    trafficPlan: args.stages,
    totalPlannedRequests: args.totalPlannedRequests,
    totals: {
      requests: args.records.length,
      success200: args.records.filter((record) => record.status === 200).length,
      expected429: args.records.filter((record) => record.status === 429).length,
      realFailures: realFailureCount,
      realFailureRateExcluding429Pct:
        realFailureBase === 0
          ? null
          : round((realFailureCount / realFailureBase) * 100),
    },
    latencyMs: {
      all: summarizeLatency(args.records),
      non429: summarizeLatency(non429),
      successOnly: summarizeLatency(
        args.records.filter((record) => record.status === 200),
      ),
    },
    statusCounts,
    codeCounts,
    perStage: args.stages.map((stage) =>
      buildStageSummary(
        stage.name,
        args.records.filter((record) => record.stage === stage.name),
      ),
    ),
    requestUrlPreview: redactUrlForSummary(args.url),
  }
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('STAGING_BASE_URL').replace(/\/+$/, '')
  const profile = loadTestProfileEnv('LOAD_TEST_PROFILE', 'smoke')
  const stages = STAGE_PROFILES[profile]

  const config: AvailabilityBootstrapConfig = {
    professionalId: requireEnv('LOAD_TEST_PROFESSIONAL_ID'),
    serviceId: requireEnv('LOAD_TEST_SERVICE_ID'),
    mediaId: optionalEnv('LOAD_TEST_MEDIA_ID'),
    locationType: optionalEnv('LOAD_TEST_LOCATION_TYPE'),
    locationId: optionalEnv('LOAD_TEST_LOCATION_ID'),
    clientAddressId: optionalEnv('LOAD_TEST_CLIENT_ADDRESS_ID'),
    addOnIds: csvEnv('LOAD_TEST_ADD_ON_IDS'),
    startDate: optionalEnv('LOAD_TEST_START_DATE'),
    days: intEnv('LOAD_TEST_SUMMARY_DAYS', 14),
    includeOtherPros: boolEnv('LOAD_TEST_INCLUDE_OTHER_PROS', true),
    debug: boolEnv('LOAD_TEST_AVAILABILITY_DEBUG', false),
    viewerLat: optionalFloatEnv('LOAD_TEST_VIEWER_LAT'),
    viewerLng: optionalFloatEnv('LOAD_TEST_VIEWER_LNG'),
    radiusMiles: optionalFloatEnv('LOAD_TEST_RADIUS_MILES'),
    stepMinutes: optionalIntEnv('LOAD_TEST_STEP_MINUTES'),
    leadMinutes: optionalIntEnv('LOAD_TEST_LEAD_MINUTES'),
  }

  if ((config.viewerLat == null) !== (config.viewerLng == null)) {
    throw new Error(
      'LOAD_TEST_VIEWER_LAT and LOAD_TEST_VIEWER_LNG must be set together.',
    )
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
  const url = buildUrl(baseUrl, config)

  const records: RequestRecord[] = []
  let nextSeq = 1

  console.log(
    JSON.stringify(
      {
        runId,
        commit: readCommitSha(),
        environment: readEnvironmentName(),
        baseUrl,
        route: 'GET /api/availability/bootstrap',
        profile,
        config,
        trafficPlan: stages,
        totalPlannedRequests,
        requestTimeoutMs,
        maxInFlight,
        usingSyntheticTrustedIpHeader: Boolean(
          trustedHeaderName && trustedIpPrefix,
        ),
        requestUrlPreview: redactUrlForSummary(url),
      },
      null,
      2,
    ),
  )

  for (const stage of stages) {
    console.log(
      `Starting stage ${stage.name} (${stage.rps} rps for ${stage.durationSeconds}s)...`,
    )

    nextSeq = await runStage({
      stage,
      startSeq: nextSeq,
      url,
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
    url,
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