import { performance } from 'node:perf_hooks'

type Stage = {
  name: string
  rps: number
  durationSeconds: number
}

type LoadTestProfile = 'smoke' | 'baseline' | 'launch' | 'stress'

type StepName = 'hold' | 'finalize'
type Bucket = 'success' | 'expected409' | 'expected429' | 'realFailure'
type StatusValue = number | 'TIMEOUT' | 'NETWORK'

type RequestRecord = {
  stage: string
  step: StepName
  durationMs: number
  status: StatusValue
  code: string | null
  bucket: Bucket
  bodyPreview: string | null
}

type BookingFinalizeLoadConfig = {
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

type HoldCreateResult = {
  holdId: string
}

const STAGE_PROFILES: Record<LoadTestProfile, readonly Stage[]> = {
  smoke: [{ name: 'smoke-1-rps', rps: 1, durationSeconds: 5 }],
  baseline: [
    { name: '2-rps', rps: 2, durationSeconds: 30 },
    { name: '5-rps', rps: 5, durationSeconds: 30 },
  ],
  launch: [
    { name: '5-rps', rps: 5, durationSeconds: 60 },
    { name: '10-rps', rps: 10, durationSeconds: 60 },
    { name: '25-rps', rps: 25, durationSeconds: 60 },
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

function readRecordField(
  source: Record<string, unknown> | null,
  name: string,
): Record<string, unknown> | null {
  if (!source) return null

  const value = source[name]
  return isRecord(value) ? value : null
}

function readStringField(
  source: Record<string, unknown> | null,
  name: string,
): string | null {
  if (!source) return null

  const value = source[name]
  return typeof value === 'string' && value.trim() ? value : null
}

function readStringArrayField(
  source: Record<string, unknown> | null,
  name: string,
): string[] {
  if (!source) return []

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
  idempotencyPrefix: string
}): HeadersInit {
  const origin = new URL(args.baseUrl).origin

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    cookie: args.clientCookie,
    origin,
    referer: `${origin}/`,
    'idempotency-key': `${args.idempotencyPrefix}-${args.runId}-${args.seq}`,
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

function buildBootstrapUrl(
  baseUrl: string,
  config: BookingFinalizeLoadConfig,
): string {
  const url = new URL('/api/v1/availability/bootstrap', baseUrl)

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
  config: BookingFinalizeLoadConfig
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

/**
 * Adjust here if your finalize route expects a different body shape.
 *
 * Current assumption:
 * POST /api/v1/bookings/finalize
 * body: { holdId }
 */
function buildFinalizePayload(args: {
  holdId: string
  config: BookingFinalizeLoadConfig
  selection: BootstrapSelection
}) {
  return {
    holdId: args.holdId,
    offeringId: args.selection.offeringId,
    serviceId: args.config.serviceId,
    locationType: args.selection.locationType,
    locationId: args.selection.locationId,
    clientAddressId: args.config.clientAddressId,
    addOnIds: args.config.addOnIds,
  }
}

function classifyStatus(status: StatusValue): Bucket {
  if (status === 200 || status === 201) return 'success'
  if (status === 409) return 'expected409'
  if (status === 429) return 'expected429'

  return 'realFailure'
}

function parseJson(bodyText: string): unknown {
  if (!bodyText) return null

  try {
    return JSON.parse(bodyText)
  } catch {
    return null
  }
}

function parseCode(bodyText: string): string | null {
  const parsed = parseJson(bodyText)

  if (
    isRecord(parsed) &&
    typeof parsed.code === 'string' &&
    parsed.code.trim()
  ) {
    return parsed.code
  }

  if (
    isRecord(parsed) &&
    isRecord(parsed.error) &&
    typeof parsed.error.code === 'string' &&
    parsed.error.code.trim()
  ) {
    return parsed.error.code
  }

  return null
}

function parseHoldId(bodyText: string): string | null {
  const parsed = parseJson(bodyText)

  if (!isRecord(parsed)) return null

  const directHold = readRecordField(parsed, 'hold')
  const data = readRecordField(parsed, 'data')
  const dataHold = readRecordField(data, 'hold')

  return (
    readStringField(parsed, 'holdId') ??
    readStringField(directHold, 'id') ??
    readStringField(dataHold, 'id') ??
    readStringField(data, 'holdId')
  )
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
  config: BookingFinalizeLoadConfig
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

    const request = readRecordField(parsed, 'request')
    const primaryPro = readRecordField(parsed, 'primaryPro')
    const selectedDay = readRecordField(parsed, 'selectedDay')

    const offeringId =
      readStringField(parsed, 'offeringId') ??
      readStringField(request, 'offeringId') ??
      readStringField(primaryPro, 'offeringId')

    const locationType =
      readStringField(parsed, 'locationType') ??
      readStringField(request, 'locationType')

    const locationId =
      readStringField(parsed, 'locationId') ??
      readStringField(request, 'locationId')

    const slots = readStringArrayField(selectedDay, 'slots')

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(
      `Availability bootstrap request failed for ${url}: ${message}`,
      {
        cause: error,
      },
    )
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
    throw new Error('No slots are available for booking-finalize load test.')
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
      `Slot pool exhausted after ${args.slots.length} requests. Use LOAD_TEST_PROFILE=smoke, increase LOAD_TEST_SUMMARY_DAYS if the API returns more selected slots, or set LOAD_TEST_ALLOW_SLOT_REUSE=true if conflict pressure is intentional.`,
    )
  }

  const slot = args.slots[index % args.slots.length]
  if (!slot) {
    throw new Error(`Slot ${index % args.slots.length} is empty.`)
  }

  return slot
}

async function postJson(args: {
  step: StepName
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  route: string
  payload: unknown
  config: BookingFinalizeLoadConfig
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
  idempotencyPrefix: string
}): Promise<RequestRecord & { bodyText: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(new URL(args.route, args.baseUrl), {
      method: 'POST',
      headers: buildHeaders({
        seq: args.seq,
        runId: args.runId,
        baseUrl: args.baseUrl,
        clientCookie: args.config.clientCookie,
        trustedHeaderName: args.trustedHeaderName,
        trustedIpPrefix: args.trustedIpPrefix,
        idempotencyPrefix: args.idempotencyPrefix,
      }),
      body: JSON.stringify(args.payload),
      signal: controller.signal,
    })

    const bodyText = await response.text().catch(() => '')
    const durationMs = performance.now() - startedAt
    const status = response.status
    const code = parseCode(bodyText)

    return {
      stage: args.stage.name,
      step: args.step,
      durationMs,
      status,
      code,
      bucket: classifyStatus(status),
      bodyPreview:
        response.ok || response.status === 409 || response.status === 429
          ? null
          : bodyText.slice(0, 300),
      bodyText,
    }
  } catch (error) {
    const durationMs = performance.now() - startedAt
    const status: StatusValue =
      error instanceof Error && error.name === 'AbortError'
        ? 'TIMEOUT'
        : 'NETWORK'

    return {
      stage: args.stage.name,
      step: args.step,
      durationMs,
      status,
      code: null,
      bucket: 'realFailure',
      bodyPreview: null,
      bodyText: '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function createHold(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  holdRoute: string
  config: BookingFinalizeLoadConfig
  selection: BootstrapSelection
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<{
  record: RequestRecord
  result: HoldCreateResult | null
}> {
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

  const response = await postJson({
    step: 'hold',
    stage: args.stage,
    seq: args.seq,
    runId: args.runId,
    baseUrl: args.baseUrl,
    route: args.holdRoute,
    payload,
    config: args.config,
    requestTimeoutMs: args.requestTimeoutMs,
    trustedHeaderName: args.trustedHeaderName,
    trustedIpPrefix: args.trustedIpPrefix,
    idempotencyPrefix: 'booking-finalize-load-hold',
  })

  const { bodyText, ...record } = response

  if (record.bucket !== 'success') {
    return {
      record,
      result: null,
    }
  }

  const holdId = parseHoldId(bodyText)

  if (!holdId) {
    return {
      record: {
        ...record,
        bucket: 'realFailure',
        bodyPreview:
          bodyText.slice(0, 300) ||
          'Hold create response did not include a hold id.',
      },
      result: null,
    }
  }

  return {
    record,
    result: { holdId },
  }
}

async function finalizeBooking(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  finalizeRoute: string
  config: BookingFinalizeLoadConfig
  selection: BootstrapSelection
  holdId: string
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord> {
  const response = await postJson({
    step: 'finalize',
    stage: args.stage,
    seq: args.seq,
    runId: args.runId,
    baseUrl: args.baseUrl,
    route: args.finalizeRoute,
    payload: buildFinalizePayload({
        holdId: args.holdId,
        config: args.config,
        selection: args.selection,
    }),
    config: args.config,
    requestTimeoutMs: args.requestTimeoutMs,
    trustedHeaderName: args.trustedHeaderName,
    trustedIpPrefix: args.trustedIpPrefix,
    idempotencyPrefix: 'booking-finalize-load-finalize',
  })

  const { bodyText: _bodyText, ...record } = response
  return record
}

async function sendFlow(args: {
  stage: Stage
  seq: number
  runId: string
  baseUrl: string
  holdRoute: string
  finalizeRoute: string
  config: BookingFinalizeLoadConfig
  selection: BootstrapSelection
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
}): Promise<RequestRecord[]> {
  const hold = await createHold({
    stage: args.stage,
    seq: args.seq,
    runId: args.runId,
    baseUrl: args.baseUrl,
    holdRoute: args.holdRoute,
    config: args.config,
    selection: args.selection,
    requestTimeoutMs: args.requestTimeoutMs,
    trustedHeaderName: args.trustedHeaderName,
    trustedIpPrefix: args.trustedIpPrefix,
  })

  if (!hold.result) {
    return [hold.record]
  }

const finalize = await finalizeBooking({
  stage: args.stage,
  seq: args.seq,
  runId: args.runId,
  baseUrl: args.baseUrl,
  finalizeRoute: args.finalizeRoute,
  config: args.config,
  selection: args.selection,
  holdId: hold.result.holdId,
  requestTimeoutMs: args.requestTimeoutMs,
  trustedHeaderName: args.trustedHeaderName,
  trustedIpPrefix: args.trustedIpPrefix,
})

  return [hold.record, finalize]
}

async function runStage(args: {
  stage: Stage
  startSeq: number
  runId: string
  baseUrl: string
  holdRoute: string
  finalizeRoute: string
  config: BookingFinalizeLoadConfig
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

      const task = sendFlow({
        stage: args.stage,
        seq,
        runId: args.runId,
        baseUrl: args.baseUrl,
        holdRoute: args.holdRoute,
        finalizeRoute: args.finalizeRoute,
        config: args.config,
        selection: args.selection,
        requestTimeoutMs: args.requestTimeoutMs,
        trustedHeaderName: args.trustedHeaderName,
        trustedIpPrefix: args.trustedIpPrefix,
      })
        .then((records) => {
          args.records.push(...records)
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

function summarizeRecords(records: RequestRecord[]) {
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

function buildStageSummary(stageName: string, records: RequestRecord[]) {
  return {
    stage: stageName,
    ...summarizeRecords(records),
    byStep: {
      hold: summarizeRecords(records.filter((record) => record.step === 'hold')),
      finalize: summarizeRecords(
        records.filter((record) => record.step === 'finalize'),
      ),
    },
  }
}

function buildSummary(args: {
  runId: string
  baseUrl: string
  holdRoute: string
  finalizeRoute: string
  profile: LoadTestProfile
  stages: readonly Stage[]
  totalPlannedFlows: number
  config: BookingFinalizeLoadConfig
  selection: BootstrapSelection
  records: RequestRecord[]
}) {
  return {
    runId: args.runId,
    commit: readCommitSha(),
    environment: readEnvironmentName(),
    baseUrl: args.baseUrl,
    routes: {
      hold: `POST ${args.holdRoute}`,
      finalize: `POST ${args.finalizeRoute}`,
    },
    profile: args.profile,
    trafficPlan: args.stages,
    totalPlannedFlows: args.totalPlannedFlows,
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
      flowsAttempted: args.totalPlannedFlows,
      hold: summarizeRecords(
        args.records.filter((record) => record.step === 'hold'),
      ),
      finalize: summarizeRecords(
        args.records.filter((record) => record.step === 'finalize'),
      ),
      allSteps: summarizeRecords(args.records),
    },
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

  const config: BookingFinalizeLoadConfig = {
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

  const holdRoute = optionalEnv('LOAD_TEST_HOLD_ROUTE') ?? '/api/v1/holds'
  const finalizeRoute =
    optionalEnv('LOAD_TEST_FINALIZE_ROUTE') ?? '/api/v1/bookings/finalize'
  const requestTimeoutMs = intEnv('LOAD_TEST_REQUEST_TIMEOUT_MS', 15000)
  const maxInFlight = intEnv('LOAD_TEST_MAX_IN_FLIGHT', 2000)

  const totalPlannedFlows = stages.reduce(
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
    selection.slots.length < totalPlannedFlows
  ) {
    throw new Error(
      `Availability bootstrap returned ${selection.slots.length} selected-day slots, but profile "${profile}" requires ${totalPlannedFlows} booking finalize flows. Use LOAD_TEST_PROFILE=smoke, increase LOAD_TEST_SUMMARY_DAYS if the API returns more selected slots, or set LOAD_TEST_ALLOW_SLOT_REUSE=true if conflict pressure is intentional.`,
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
        routes: {
          hold: `POST ${holdRoute}`,
          finalize: `POST ${finalizeRoute}`,
        },
        profile,
        trafficPlan: stages,
        totalPlannedFlows,
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
      `Starting stage ${stage.name} (${stage.rps} booking finalize flows per second for ${stage.durationSeconds}s)...`,
    )

    nextSeq = await runStage({
      stage,
      startSeq: nextSeq,
      runId,
      baseUrl,
      holdRoute,
      finalizeRoute,
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
    finalizeRoute,
    profile,
    stages,
    totalPlannedFlows,
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