
// scripts/perf/aggregateAvailabilityPerf.mjs
import { promises as fs } from 'fs'
import path from 'path'

const ROOT = process.cwd()
const PERF_DIR = path.join(ROOT, 'artifacts', 'perf', 'availability')

const RAW_DESKTOP_PATH = path.join(PERF_DIR, 'raw-desktop.json')
const RAW_MOBILE_PATH = path.join(PERF_DIR, 'raw-mobile.json')
const SUMMARY_JSON_PATH = path.join(PERF_DIR, 'summary.json')
const SUMMARY_MD_PATH = path.join(PERF_DIR, 'summary.md')

const BUDGET_SOURCE = 'docs/performance/availability-gate2-budget.json'

const REQUIRED_METRICS = [
  'drawer_open_to_first_usable_ms',
  'day_switch_to_times_visible_ms',
  'hold_request_latency_ms',
  'continue_to_add_ons_ms',
  'background_refresh_ms',
]

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function environmentLabel(projectName, environment) {
  if (environment === 'mobile') return 'Pixel 7 emulation'
  if (environment === 'desktop') return 'Desktop Chrome'
  return projectName || 'Unknown'
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}

function nearestRank(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null
  const rank = Math.max(1, Math.ceil((percentile / 100) * sortedValues.length))
  return sortedValues[Math.min(sortedValues.length - 1, rank - 1)]
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Number((total / values.length).toFixed(2))
}

function summarizeMetric(samples) {
  const valid = samples.filter(
    (sample) =>
      sample &&
      sample.invalid !== true &&
      typeof sample.durationMs === 'number' &&
      Number.isFinite(sample.durationMs),
  )

  const invalid = samples.filter((sample) => sample?.invalid === true)

  const invalidReasons = {}
  for (const sample of invalid) {
    const reason =
      typeof sample.invalidReason === 'string' && sample.invalidReason.trim()
        ? sample.invalidReason.trim()
        : 'unknown'
    invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1
  }

  if (valid.length === 0) {
    return {
      count: 0,
      invalidCount: invalid.length,
      invalidReasons,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
    }
  }

  const durations = valid
    .map((sample) => sample.durationMs)
    .slice()
    .sort((a, b) => a - b)

  return {
    count: durations.length,
    invalidCount: invalid.length,
    invalidReasons,
    min: durations[0],
    max: durations[durations.length - 1],
    mean: mean(durations),
    p50: nearestRank(durations, 50),
    p95: nearestRank(durations, 95),
    p99: nearestRank(durations, 99),
  }
}

function buildEnvironmentSummary(rawArtifact) {
  const samples = Array.isArray(rawArtifact?.samples) ? rawArtifact.samples : []

  const metrics = {}
  for (const metric of REQUIRED_METRICS) {
    metrics[metric] = summarizeMetric(
      samples.filter((sample) => sample?.metric === metric),
    )
  }

  const invalidReasons = {}
  let invalidSampleCount = 0

  for (const metric of REQUIRED_METRICS) {
    const metricSummary = metrics[metric]
    invalidSampleCount += metricSummary.invalidCount
    for (const [reason, count] of Object.entries(metricSummary.invalidReasons)) {
      invalidReasons[reason] = (invalidReasons[reason] ?? 0) + count
    }
  }

  return {
    deviceProfile:
      typeof rawArtifact?.deviceProfile === 'string' && rawArtifact.deviceProfile
        ? rawArtifact.deviceProfile
        : environmentLabel(rawArtifact?.projectName, rawArtifact?.environment),
    projectName:
      typeof rawArtifact?.projectName === 'string' ? rawArtifact.projectName : null,
    totalRawSamples: samples.length,
    invalidSampleCount,
    invalidReasons,
    metrics,
  }
}

function buildSummary(desktopRaw, mobileRaw) {
  const desktop = buildEnvironmentSummary(desktopRaw)
  const mobile = buildEnvironmentSummary(mobileRaw)

  return {
    gate: 2,
    suite: 'availability',
    generatedAt: new Date().toISOString(),
    budgetSource: BUDGET_SOURCE,
    artifacts: {
      rawDesktop: 'artifacts/perf/availability/raw-desktop.json',
      rawMobile: 'artifacts/perf/availability/raw-mobile.json',
      summaryJson: 'artifacts/perf/availability/summary.json',
      summaryMarkdown: 'artifacts/perf/availability/summary.md',
    },
    environments: {
      desktop,
      mobile,
    },
    budgetCheck: {
      passed: null,
      note: 'Set by checkAvailabilityBudgets.mjs',
    },
  }
}

function formatNumber(value) {
  if (value == null) return '—'
  return String(value)
}

function metricLabel(metric) {
  return metric.replace(/_ms$/, '').replaceAll('_', ' ')
}

function buildMetricTable(environmentName, environmentSummary) {
  const lines = []
  lines.push(`## ${environmentName}`)
  lines.push('')
  lines.push(`Device profile: ${environmentSummary.deviceProfile ?? 'Unknown'}`)
  lines.push('')
  lines.push('| Metric | Count | Invalid | Min | Mean | p50 | p95 | p99 | Max |')
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')

  for (const metric of REQUIRED_METRICS) {
    const summary = environmentSummary.metrics[metric]
    lines.push(
      `| ${metricLabel(metric)} | ${formatNumber(summary.count)} | ${formatNumber(summary.invalidCount)} | ${formatNumber(summary.min)} | ${formatNumber(summary.mean)} | ${formatNumber(summary.p50)} | ${formatNumber(summary.p95)} | ${formatNumber(summary.p99)} | ${formatNumber(summary.max)} |`,
    )
  }

  lines.push('')
  lines.push(`Total raw samples: ${environmentSummary.totalRawSamples}`)
  lines.push(`Invalid samples: ${environmentSummary.invalidSampleCount}`)
  lines.push('')

  const reasons = Object.entries(environmentSummary.invalidReasons)
  if (reasons.length === 0) {
    lines.push('Invalid reasons: none')
    lines.push('')
    return lines
  }

  lines.push('Invalid reasons:')
  for (const [reason, count] of reasons.sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${reason}: ${count}`)
  }
  lines.push('')

  return lines
}

function buildMarkdown(summary) {
  const lines = []
  lines.push('# Gate 2 Availability Performance Summary')
  lines.push('')
  lines.push(`Generated at: ${summary.generatedAt}`)
  lines.push(`Budget source: ${summary.budgetSource}`)
  lines.push('')

  lines.push(...buildMetricTable('Desktop', summary.environments.desktop))
  lines.push(...buildMetricTable('Mobile', summary.environments.mobile))

  lines.push('## Artifact paths')
  lines.push('')
  lines.push(`- ${summary.artifacts.rawDesktop}`)
  lines.push(`- ${summary.artifacts.rawMobile}`)
  lines.push(`- ${summary.artifacts.summaryJson}`)
  lines.push(`- ${summary.artifacts.summaryMarkdown}`)
  lines.push('')

  lines.push('## Budget check')
  lines.push('')
  lines.push('Pending. Run `scripts/perf/checkAvailabilityBudgets.mjs` to set pass/fail.')
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function main() {
  const [desktopRaw, mobileRaw] = await Promise.all([
    readJson(RAW_DESKTOP_PATH),
    readJson(RAW_MOBILE_PATH),
  ])

  if (!isObject(desktopRaw) || !isObject(mobileRaw)) {
    throw new Error('Raw perf artifacts must be JSON objects.')
  }

  const summary = buildSummary(desktopRaw, mobileRaw)
  const markdown = buildMarkdown(summary)

  await fs.mkdir(PERF_DIR, { recursive: true })
  await Promise.all([
    fs.writeFile(SUMMARY_JSON_PATH, JSON.stringify(summary, null, 2), 'utf-8'),
    fs.writeFile(SUMMARY_MD_PATH, markdown, 'utf-8'),
  ])

  process.stdout.write(
    [
      `[OK] wrote ${path.relative(ROOT, SUMMARY_JSON_PATH)}`,
      `[OK] wrote ${path.relative(ROOT, SUMMARY_MD_PATH)}`,
    ].join('\n') + '\n',
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[FAIL] aggregateAvailabilityPerf.mjs: ${message}\n`)
  process.exit(1)
})