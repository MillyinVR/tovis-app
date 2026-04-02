// scripts/perf/checkAvailabilityBudgets.mjs
import { promises as fs } from 'fs'
import path from 'path'

const ROOT = process.cwd()

const SUMMARY_JSON_PATH = path.join(
  ROOT,
  'artifacts',
  'perf',
  'availability',
  'summary.json',
)
const SUMMARY_MD_PATH = path.join(
  ROOT,
  'artifacts',
  'perf',
  'availability',
  'summary.md',
)
const BUDGET_JSON_PATH = path.join(
  ROOT,
  'docs',
  'performance',
  'availability-gate2-budget.json',
)
const BASELINE_JSON_PATH = path.join(
  ROOT,
  'docs',
  'performance',
  'baselines',
  'availability-gate2-baseline.json',
)

const REQUIRED_ENVIRONMENTS = ['desktop', 'mobile']
const REQUIRED_METRICS = [
  'drawer_open_to_first_usable_ms',
  'day_switch_to_times_visible_ms',
  'hold_request_latency_ms',
  'continue_to_add_ons_ms',
  'background_refresh_ms',
]

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}

async function tryReadJson(filePath) {
  try {
    return await readJson(filePath)
  } catch {
    return null
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatValue(value) {
  if (value == null) return 'null'
  return String(value)
}

function readBudgetForMetric(budget, metric) {
  const metricBudget = budget?.metrics?.[metric]?.budgets_ms
  if (!isObject(metricBudget)) return null

  return {
    p50: metricBudget.p50 ?? null,
    p95: metricBudget.p95 ?? null,
    p99: metricBudget.p99 ?? null,
  }
}

function getRequiredSampleCount(budget) {
  const value =
    budget?.test_conditions?.sample_size?.minimum_per_metric_per_environment_for_pr_gating

  return Number.isFinite(value) ? Number(value) : 30
}

function getBaselineMetric(baseline, environment, metric) {
  return baseline?.environments?.[environment]?.metrics?.[metric] ?? null
}

function compareBaseline(currentP95, baselineP95) {
  if (!Number.isFinite(currentP95) || !Number.isFinite(baselineP95) || baselineP95 <= 0) {
    return null
  }

  const delta = ((currentP95 - baselineP95) / baselineP95) * 100
  return Number(delta.toFixed(2))
}

async function writeSummaryArtifacts(summary, markdown) {
  await Promise.all([
    fs.writeFile(SUMMARY_JSON_PATH, JSON.stringify(summary, null, 2), 'utf-8'),
    fs.writeFile(SUMMARY_MD_PATH, markdown, 'utf-8'),
  ])
}

function updateMarkdownSummary(existingMarkdown, results) {
  const lines = []
  lines.push('## Budget check')
  lines.push('')
  lines.push(`Result: ${results.passed ? 'PASS' : 'FAIL'}`)
  lines.push('')

  if (results.failures.length > 0) {
    lines.push('Failures:')
    for (const line of results.failures) {
      lines.push(`- ${line}`)
    }
    lines.push('')
  }

  if (results.warnings.length > 0) {
    lines.push('Warnings:')
    for (const line of results.warnings) {
      lines.push(`- ${line}`)
    }
    lines.push('')
  }

  if (results.passes.length > 0) {
    lines.push('Passes:')
    for (const line of results.passes) {
      lines.push(`- ${line}`)
    }
    lines.push('')
  }

  const section = `${lines.join('\n')}\n`

  const pendingLine =
    'Pending. Run `scripts/perf/checkAvailabilityBudgets.mjs` to set pass/fail.'
  if (existingMarkdown.includes(pendingLine)) {
    return existingMarkdown.replace(/## Budget check[\s\S]*$/m, section)
  }

  return `${existingMarkdown.trimEnd()}\n\n${section}`
}

async function main() {
  const [summary, budget, baseline, existingMarkdown] = await Promise.all([
    readJson(SUMMARY_JSON_PATH),
    readJson(BUDGET_JSON_PATH),
    tryReadJson(BASELINE_JSON_PATH),
    fs.readFile(SUMMARY_MD_PATH, 'utf-8'),
  ])

  if (!isObject(summary)) {
    throw new Error('summary.json must be a JSON object.')
  }

  if (!isObject(budget)) {
    throw new Error('availability-gate2-budget.json must be a JSON object.')
  }

  const requiredSampleCount = getRequiredSampleCount(budget)

  const passes = []
  const failures = []
  const warnings = []

  for (const environment of REQUIRED_ENVIRONMENTS) {
    const envSummary = summary?.environments?.[environment]

    if (!isObject(envSummary)) {
      failures.push(`[FAIL] ${environment} environment missing from summary`)
      continue
    }

    for (const metric of REQUIRED_METRICS) {
      const metricSummary = envSummary?.metrics?.[metric]
      const metricBudget = readBudgetForMetric(budget, metric)

      if (!isObject(metricSummary)) {
        failures.push(`[FAIL] ${environment} ${metric} summary missing`)
        continue
      }

      if (!metricBudget) {
        failures.push(`[FAIL] ${environment} ${metric} budget missing`)
        continue
      }

      const count = metricSummary.count
      const invalidCount = metricSummary.invalidCount
      const p50 = metricSummary.p50
      const p95 = metricSummary.p95
      const p99 = metricSummary.p99

      if (!Number.isFinite(count) || count < requiredSampleCount) {
        failures.push(
          `[FAIL] ${environment} ${metric} sample_count=${formatValue(count)} required=${requiredSampleCount}`,
        )
      }

      if (!Number.isFinite(p95)) {
        failures.push(`[FAIL] ${environment} ${metric} p95 missing`)
      } else if (p95 > metricBudget.p95) {
        failures.push(
          `[FAIL] ${environment} ${metric} p95=${formatValue(p95)} budget=${formatValue(metricBudget.p95)}`,
        )
      } else {
        passes.push(
          `[PASS] ${environment} ${metric} p95=${formatValue(p95)} budget=${formatValue(metricBudget.p95)}`,
        )
      }

      if (!Number.isFinite(p99)) {
        failures.push(`[FAIL] ${environment} ${metric} p99 missing`)
      } else if (p99 > metricBudget.p99) {
        failures.push(
          `[FAIL] ${environment} ${metric} p99=${formatValue(p99)} budget=${formatValue(metricBudget.p99)}`,
        )
      } else {
        passes.push(
          `[PASS] ${environment} ${metric} p99=${formatValue(p99)} budget=${formatValue(metricBudget.p99)}`,
        )
      }

      if (Number.isFinite(p50) && p50 > metricBudget.p50) {
        warnings.push(
          `[WARN] ${environment} ${metric} p50=${formatValue(p50)} budget=${formatValue(metricBudget.p50)}`,
        )
      }

      if (Number.isFinite(invalidCount) && invalidCount > 0) {
        warnings.push(
          `[WARN] ${environment} ${metric} invalid_count=${formatValue(invalidCount)}`,
        )
      }

      const baselineMetric = getBaselineMetric(baseline, environment, metric)
      const baselineP95 = baselineMetric?.p95
      const deltaPct = compareBaseline(p95, baselineP95)
      if (deltaPct != null && deltaPct > 15) {
        warnings.push(
          `[WARN] ${environment} ${metric} p95_regression=${deltaPct}% baseline=${formatValue(baselineP95)} current=${formatValue(p95)}`,
        )
      }
    }
  }

  const passed = failures.length === 0

  summary.budgetCheck = {
    passed,
    checkedAt: new Date().toISOString(),
    requiredSampleCount,
    failures,
    warnings,
    passes,
  }

  const updatedMarkdown = updateMarkdownSummary(existingMarkdown, {
    passed,
    failures,
    warnings,
    passes,
  })

  await writeSummaryArtifacts(summary, updatedMarkdown)

  for (const line of passes) {
    process.stdout.write(`${line}\n`)
  }

  for (const line of warnings) {
    process.stdout.write(`${line}\n`)
  }

  for (const line of failures) {
    process.stderr.write(`${line}\n`)
  }

  process.stdout.write(
    `Gate 2 availability performance: ${passed ? 'PASS' : 'FAIL'}\n`,
  )

  if (!passed) {
    process.exit(1)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[FAIL] checkAvailabilityBudgets.mjs: ${message}\n`)
  process.exit(1)
})