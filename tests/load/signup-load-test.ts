import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

type Stage = {
  name: string
  rps: number
  durationSeconds: number
}

type Bucket = 'success' | 'expected429' | 'realFailure'
type StatusValue = number | 'TIMEOUT' | 'NETWORK'

type RequestRecord = {
  stage: string
  durationMs: number
  status: StatusValue
  code: string | null
  bucket: Bucket
}

const STAGES: readonly Stage[] = [
  { name: '10-rps', rps: 10, durationSeconds: 60 },
  { name: '50-rps', rps: 50, durationSeconds: 60 },
  { name: '100-rps', rps: 100, durationSeconds: 60 },
  { name: '200-rps', rps: 200, durationSeconds: 120 },
] as const

// Repo-confirmed CLIENT signup shape from SignupClientClient.tsx.
// This intentionally avoids the PRO + CA-license DCA branch in this step.
const DEFAULT_SIGNUP_LOCATION = Object.freeze({
  kind: 'CLIENT_ZIP',
  postalCode: '92101',
  city: 'San Diego',
  state: 'CA',
  countryCode: 'US',
  lat: 32.7157,
  lng: -117.1611,
  timeZoneId: 'America/Los_Angeles',
})

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

async function loadPhonePool(path: string | null): Promise<string[] | null> {
  if (!path) return null

  const raw = await readFile(path, 'utf8')
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    throw new Error(`LOAD_TEST_PHONE_POOL_FILE is empty: ${path}`)
  }

  return lines
}

function createPhoneAllocator(
  phonePool: string[] | null,
  allowGeneratedPhones: boolean,
) {
  let cursor = 0

  return {
    next(seq: number): string {
      if (phonePool) {
        if (cursor >= phonePool.length) {
          throw new Error(
            `Phone pool exhausted after ${cursor} requests. Add more numbers to LOAD_TEST_PHONE_POOL_FILE.`,
          )
        }

        const value = phonePool[cursor]
        cursor += 1

        if (!value) {
          throw new Error('Encountered an empty phone entry in the phone pool.')
        }

        return value
      }

      if (!allowGeneratedPhones) {
        throw new Error(
          'No phone pool configured. Set LOAD_TEST_PHONE_POOL_FILE, or set ALLOW_GENERATED_PHONE_NUMBERS=true only when staging is guaranteed to use non-delivering SMS test credentials/sinks.',
        )
      }

      // Explicit opt-in only. This is intentionally not the default path.
      const lastTenDigits = String(10_000_000_000 + seq).slice(-10)
      return `+1${lastTenDigits}`
    },
  }
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
    'content-type': 'application/json',
  }

  if (trustedHeaderName && trustedIpPrefix) {
    headers[trustedHeaderName] = buildTrustedIp(seq, trustedIpPrefix)
  }

  return headers
}

function buildPayload(
  seq: number,
  runId: string,
  turnstileToken: string,
  phone: string,
) {
  return {
    email: `signup.load+${runId}.${seq}@example.com`,
    password: 'SuperSecret123!',
    role: 'CLIENT',
    firstName: 'Load',
    lastName: 'Test',
    phone,
    tosAccepted: true,
    turnstileToken,
    signupLocation: DEFAULT_SIGNUP_LOCATION,
  }
}

function classifyStatus(status: StatusValue): Bucket {
  if (status === 201) return 'success'
  if (status === 429) return 'expected429'
  return 'realFailure'
}

function parseCode(bodyText: string): string | null {
  if (!bodyText) return null

  try {
    const parsed = JSON.parse(bodyText) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
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
  runId: string
  baseUrl: string
  turnstileToken: string
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
  phoneAllocator: ReturnType<typeof createPhoneAllocator>
}): Promise<RequestRecord> {
  const phone = args.phoneAllocator.next(args.seq)
  const payload = buildPayload(args.seq, args.runId, args.turnstileToken, phone)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(`${args.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: buildHeaders(
        args.seq,
        args.trustedHeaderName,
        args.trustedIpPrefix,
      ),
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
  runId: string
  baseUrl: string
  turnstileToken: string
  requestTimeoutMs: number
  trustedHeaderName: string | null
  trustedIpPrefix: string | null
  maxInFlight: number
  phoneAllocator: ReturnType<typeof createPhoneAllocator>
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
        turnstileToken: args.turnstileToken,
        requestTimeoutMs: args.requestTimeoutMs,
        trustedHeaderName: args.trustedHeaderName,
        trustedIpPrefix: args.trustedIpPrefix,
        phoneAllocator: args.phoneAllocator,
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
    success201: records.filter((record) => record.status === 201).length,
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
        records.filter((record) => record.status === 201),
      ),
    },
    statusCounts,
    codeCounts,
  }
}

function buildSummary(args: {
  runId: string
  baseUrl: string
  phoneSource: string
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
    baseUrl: args.baseUrl,
    route: 'POST /api/auth/register',
    roleUnderTest: 'CLIENT',
    phoneSource: args.phoneSource,
    trafficPlan: STAGES,
    totals: {
      requests: args.records.length,
      success201: args.records.filter((record) => record.status === 201).length,
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
        args.records.filter((record) => record.status === 201),
      ),
    },
    statusCounts,
    codeCounts,
    perStage: STAGES.map((stage) =>
      buildStageSummary(
        stage.name,
        args.records.filter((record) => record.stage === stage.name),
      ),
    ),
  }
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('STAGING_BASE_URL').replace(/\/+$/, '')
  const turnstileToken = requireEnv('TURNSTILE_TEST_TOKEN')

  const phonePoolFile = optionalEnv('LOAD_TEST_PHONE_POOL_FILE')
  const allowGeneratedPhones = boolEnv(
    'ALLOW_GENERATED_PHONE_NUMBERS',
    false,
  )

  const trustedHeaderName = optionalEnv('LOAD_TEST_TRUSTED_IP_HEADER_NAME')
  const trustedIpPrefix = optionalEnv('LOAD_TEST_TRUSTED_IP_PREFIX')

  const requestTimeoutMs = intEnv('LOAD_TEST_REQUEST_TIMEOUT_MS', 15000)
  const maxInFlight = intEnv('LOAD_TEST_MAX_IN_FLIGHT', 2000)

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '')
  const phonePool = await loadPhonePool(phonePoolFile)
  const phoneAllocator = createPhoneAllocator(phonePool, allowGeneratedPhones)

  if ((trustedHeaderName && !trustedIpPrefix) || (!trustedHeaderName && trustedIpPrefix)) {
    throw new Error(
      'LOAD_TEST_TRUSTED_IP_HEADER_NAME and LOAD_TEST_TRUSTED_IP_PREFIX must be set together.',
    )
  }

  const records: RequestRecord[] = []
  let nextSeq = 1

  console.log(
    JSON.stringify(
      {
        runId,
        baseUrl,
        route: 'POST /api/auth/register',
        roleUnderTest: 'CLIENT',
        phoneSource: phonePoolFile ? `pool:${phonePoolFile}` : 'generated',
        trafficPlan: STAGES,
        requestTimeoutMs,
        maxInFlight,
        usingSyntheticTrustedIpHeader: Boolean(
          trustedHeaderName && trustedIpPrefix,
        ),
      },
      null,
      2,
    ),
  )

  for (const stage of STAGES) {
    console.log(
      `Starting stage ${stage.name} (${stage.rps} rps for ${stage.durationSeconds}s)...`,
    )

    nextSeq = await runStage({
      stage,
      startSeq: nextSeq,
      runId,
      baseUrl,
      turnstileToken,
      requestTimeoutMs,
      trustedHeaderName,
      trustedIpPrefix,
      maxInFlight,
      phoneAllocator,
      records,
    })
  }

  const summary = buildSummary({
    runId,
    baseUrl,
    phoneSource: phonePoolFile ? `pool:${phonePoolFile}` : 'generated',
    records,
  })

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})