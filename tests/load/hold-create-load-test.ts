import { performance } from 'node:perf_hooks'

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

type HoldLoadConfig = {
  professionalId: string
  serviceId: string
  offeringId: string | null
  locationType: string | null
  locationId: string | null
  clientAddressId: string | null
  addOnIds: string[]
  days: number
  includeOtherPros: boolean
  allowSlotReuse: boolean
  clientCookie: string
}

type BootstrapSelection = {
  offeringId: string
  locationType: string
  locationId: string
  slots: string[]
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringField(
  source: Record<string, unknown>,
  name: string,
): string | null {
  const value = source[name]
  return typeof value === 'string' && value.trim() ? value : null
}

function readStringArrayField(
  source: Record<string, unknown>,
  name: string,
): string[] {
  const value = source[name]

  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string')
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
  clientCookie: string
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): HeadersInit {
  const origin = new URL(args.baseUrl).origin

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    cookie: args.clientCookie,
    origin,
    referer: `${origin}/`,
    'idempotency-key': `hold-load-${args.runId}-${args.seq}`,
  }

  if (args.trustedHeaderName && args.trustedIpPrefix) {
    headers[args.trustedHeaderName] = buildTrustedIp(
      args.seq,
      args.trustedIpPrefix,
    )
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

function buildBootstrapUrl(baseUrl: string, config: HoldLoadConfig): string {
  const url = new URL('/api/availability/bootstrap', baseUrl)

  url.searchParams.set('professionalId', config.professionalId)
  url.searchParams.set('serviceId', config.serviceId)
  url.searchParams.set('days', String(config.days))
  url.searchParams.set('includeOtherPros', config.includeOtherPros ? '1' : '0')

  appendOptionalParam(url.searchParams, 'offeringId', config.offeringId)
  appendOptionalParam(url.searchParams, 'locationType', config.locationType)
  appendOptionalParam(url.searchParams, 'locationId', config.locationId)
  appendOptionalParam(
    url.searchParams,
    'clientAddressId',
    config.clientAddressId,
  )

  if (config.addOnIds.length > 0) {
    url.searchParams.set('addOnIds', config.addOnIds.join(','))
  }

  return url.toString()
}

function buildHoldPayload(args: {
  config: HoldLoadConfig
  selection: BootstrapSelection
  scheduledFor: string
}) {
  return {
    offeringId: args.selection.offeringId,
    scheduledFor: args.scheduledFor,
    locationType: args.selection.locationType,
    locationId: args.selection.locationId,
    clientAddressId: args.config.clientAddressId,
    entryPoint: 'DIRECT_PROFILE',
  }
}

function classifyStatus(status: StatusValue): Bucket {
  if (status === 200 || status === 201) return 'success'
  if (status === 409) return 'expected409'
  if (status === 429) return 'expected429'

  return 'realFailure'
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

async function fetchBootstrapSelection(args: {
  baseUrl: string
  config: HoldLoadConfig
  requestTimeoutMs: number
}): Promise<BootstrapSelection> {
  const url = buildBootstrapUrl(args.baseUrl, args.config)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    const bodyText = await response.text()

    if (!response.ok) {
      throw new Error(
        `Availability bootstrap failed with ${response.status}: ${bodyText.slice(
          0,
          500,
        )}`,
      )
    }

    const parsed: unknown = JSON.parse(bodyText)

    if (!isRecord(parsed)) {
      throw new Error('Availability bootstrap returned a non-object payload.')
    }

    const request = isRecord(parsed.request) ? parsed.request : null
    const primaryPro = isRecord(parsed.primaryPro) ? parsed.primaryPro : null
    const selectedDay = isRecord(parsed.selectedDay) ? parsed.selectedDay : null

    const offeringId =
      readStringField(parsed, 'offeringId') ??
      readStringField(request ?? {}, 'offeringId') ??
      readStringField(primaryPro ?? {}, 'offeringId')

    const locationType =
      readStringField(parsed, 'locationType') ??
      readStringField(request ?? {}, 'locationType')

    const locationId =
      readStringField(parsed, 'locationId') ??
      readStringField(request ?? {}, 'locationId')

    const slots = selectedDay ? readStringArrayField(selectedDay, 'slots') : []

    if (!offeringId) {
      throw new Error('Availability bootstrap did not return an offeringId.')
    }

    if (!locationType) {
      throw new Error('Availability bootstrap did not return a locationType.')
    }

    if (!locationId) {
      throw new Error('Availability bootstrap did not return a locationId.')
    }

    if (slots.length === 0) {
      throw new Error('Availability bootstrap did not return selectedDay.slots.')
    }

    return {
      offeringId,
      locationType,
      locationId,
      slots,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function selectSlot(args: {
  slots: readonly string[]
  seq: number
  allowSlotReuse: boolean
}): string {
  if (args.slots.length === 0) {
    throw new Error('No slots are available for hold-create load test.')
  }

  const index = args.seq - 1

  if (index < args.slots.length) {
    const slot = args.slots[index]
    if (!slot) {
      throw new Error(`Slot ${index} is empty.`)
    }

    return slot
  }

  if (!args.allowSlotReuse) {
    throw new Error(
      `Slot pool exhausted after ${args.slots.length} requests. Use LOAD_TEST_PROFILE=smoke, increase LOAD_TEST_SUMMARY_DAYS, or set LOAD_TEST_ALLOW_SLOT_REUSE=true if conflict pressure is intentional.`,
    )
  }

  const slot = args.slots[index % args.slots.length]
  if (!slot) {
    throw new Error(`Slot ${index % args.slots.length} is empty.`)
  }

  return slot
}

async function sendRequest(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  holdRoute: string
  config: HoldLoadConfig
  selection: BootstrapSelection
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord> {
  const scheduledFor = selectSlot({
    slots: args.selection.slots,
    seq: args.seq,
    allowSlotReuse: args.config.allowSlotReuse,
  })

  const payload = buildHoldPayload({
    config: args.config,
    selection: args.selection,
    scheduledFor,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(new URL(args.holdRoute, args.baseUrl), {
      method: 'POST',
      headers: buildHeaders({
        seq: args.seq,
        runId: args.runId,
        baseUrl: args.baseUrl,
        clientCookie: args.config.clientCookie,
        trustedHeaderName: args.trustedHeaderName,
        trustedIpPrefix: args.trustedIpPrefix,
      }),
      body: JSON.stringify(payload),
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
      bodyPreview:
        response.ok || response.status === 409 || response.status === 429
          ? null
          : bodyText.slice(0, 300),
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
      bodyPreview: null,
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
  holdRoute: string
  config: HoldLoadConfig
  selection: BootstrapSelection
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
        holdRoute: args.holdRoute,
        config: args.config,
        selection: args.selection,
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
    bodyPreviews: records
      .map((record) => record.bodyPreview)
      .filter((value): value is string => Boolean(value))
      .slice(0, 5),
  }
}

function buildSummary(args: {
  runId: string
  baseUrl: string
  holdRoute: string
  profile: LoadTestProfile
  stages: readonly Stage[]
  totalPlannedRequests: number
  config: HoldLoadConfig
  selection: BootstrapSelection
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
    route: `POST ${args.holdRoute}`,
    profile: args.profile,
    trafficPlan: args.stages,
    totalPlannedRequests: args.totalPlannedRequests,
    config: {
      professionalId: args.config.professionalId,
      serviceId: args.config.serviceId,
      requestedOfferingId: args.config.offeringId,
      resolvedOfferingId: args.selection.offeringId,
      requestedLocationType: args.config.locationType,
      resolvedLocationType: args.selection.locationType,
      requestedLocationId: args.config.locationId,
      resolvedLocationId: args.selection.locationId,
      clientAddressId: args.config.clientAddressId,
      addOnIds: args.config.addOnIds,
      hasClientCookie: Boolean(args.config.clientCookie),
      days: args.config.days,
      includeOtherPros: args.config.includeOtherPros,
      slotPoolSize: args.selection.slots.length,
      allowSlotReuse: args.config.allowSlotReuse,
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
      bodyPreviews: args.records
        .map((record) => record.bodyPreview)
        .filter((value): value is string => Boolean(value))
        .slice(0, 5),
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

  const config: HoldLoadConfig = {
    professionalId: requireEnv('LOAD_TEST_PROFESSIONAL_ID'),
    serviceId: requireEnv('LOAD_TEST_SERVICE_ID'),
    offeringId: optionalEnv('LOAD_TEST_OFFERING_ID'),
    locationType: optionalEnv('LOAD_TEST_LOCATION_TYPE'),
    locationId: optionalEnv('LOAD_TEST_LOCATION_ID'),
    clientAddressId: optionalEnv('LOAD_TEST_CLIENT_ADDRESS_ID'),
    addOnIds: csvEnv('LOAD_TEST_ADD_ON_IDS'),
    days: intEnv('LOAD_TEST_SUMMARY_DAYS', 14),
    includeOtherPros: boolEnv('LOAD_TEST_INCLUDE_OTHER_PROS', false),
    allowSlotReuse: boolEnv('LOAD_TEST_ALLOW_SLOT_REUSE', false),
    clientCookie: requireEnv('LOAD_TEST_CLIENT_COOKIE'),
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

  const holdRoute = optionalEnv('LOAD_TEST_HOLD_ROUTE') ?? '/api/holds'
  const requestTimeoutMs = intEnv('LOAD_TEST_REQUEST_TIMEOUT_MS', 15000)
  const maxInFlight = intEnv('LOAD_TEST_MAX_IN_FLIGHT', 2000)

  const totalPlannedRequests = stages.reduce(
    (total, stage) => total + stage.rps * stage.durationSeconds,
    0,
  )

  const selection = await fetchBootstrapSelection({
    baseUrl,
    config,
    requestTimeoutMs,
  })

  if (
    !config.allowSlotReuse &&
    selection.slots.length < totalPlannedRequests
  ) {
    throw new Error(
      `Availability bootstrap returned ${selection.slots.length} selected-day slots, but profile "${profile}" requires ${totalPlannedRequests} hold attempts. Use LOAD_TEST_PROFILE=smoke, increase LOAD_TEST_SUMMARY_DAYS if the API returns more selected slots, or set LOAD_TEST_ALLOW_SLOT_REUSE=true if conflict pressure is intentional.`,
    )
  }

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
        route: `POST ${holdRoute}`,
        profile,
        trafficPlan: stages,
        totalPlannedRequests,
        requestTimeoutMs,
        maxInFlight,
        config: {
          professionalId: config.professionalId,
          serviceId: config.serviceId,
          requestedOfferingId: config.offeringId,
          requestedLocationType: config.locationType,
          requestedLocationId: config.locationId,
          clientAddressId: config.clientAddressId,
          addOnIds: config.addOnIds,
          days: config.days,
          includeOtherPros: config.includeOtherPros,
          allowSlotReuse: config.allowSlotReuse,
          hasClientCookie: Boolean(config.clientCookie),
          resolvedOfferingId: selection.offeringId,
          resolvedLocationType: selection.locationType,
          resolvedLocationId: selection.locationId,
          slotPoolSize: selection.slots.length,
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
      `Starting stage ${stage.name} (${stage.rps} rps for ${stage.durationSeconds}s)...`,
    )

    nextSeq = await runStage({
      stage,
      startSeq: nextSeq,
      runId,
      baseUrl,
      holdRoute,
      config,
      selection,
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
    holdRoute,
    profile,
    stages,
    totalPlannedRequests,
    config,
    selection,
    records,
  })

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})