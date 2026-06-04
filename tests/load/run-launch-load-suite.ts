// tests/load/run-launch-load-suite.ts

import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'

type SuiteStep = {
  name: string
  command: string
  args: string[]
  requiredEnv: readonly string[]
  optionalEnv?: readonly string[]
  env?: Record<string, string>
}

type StepResult = {
  name: string
  command: string
  status: 'passed' | 'failed' | 'skipped'
  exitCode: number | null
  durationMs: number
  missingEnv: string[]
}

const REQUIRED_BASE_ENV = ['STAGING_BASE_URL'] as const

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function envRequiredAlias(args: {
  publicName: string
  childName: string
}): Record<string, string> {
  const value = optionalEnv(args.publicName)

  return value ? { [args.childName]: value } : {}
}

const SUITE_STEPS: readonly SuiteStep[] = [
  {
    name: 'availability-bootstrap',
    command: 'pnpm',
    args: ['test:load:availability'],
    requiredEnv: [
      ...REQUIRED_BASE_ENV,
      'LOAD_TEST_PROFESSIONAL_ID',
      'LOAD_TEST_SERVICE_ID',
    ],
  },
  {
    name: 'hold-create',
    command: 'pnpm',
    args: ['test:load:holds'],
    requiredEnv: [
      ...REQUIRED_BASE_ENV,
      'LOAD_TEST_PROFESSIONAL_ID',
      'LOAD_TEST_SERVICE_ID',
      'LOAD_TEST_CLIENT_COOKIE',
    ],
  },
  {
    name: 'booking-finalize',
    command: 'pnpm',
    args: ['test:load:booking-finalize'],
    requiredEnv: [
      ...REQUIRED_BASE_ENV,
      'LOAD_TEST_PROFESSIONAL_ID',
      'LOAD_TEST_SERVICE_ID',
      'LOAD_TEST_CLIENT_COOKIE',
    ],
  },
  {
    name: 'checkout',
    command: 'pnpm',
    args: ['test:load:checkout'],
    requiredEnv: [
      ...REQUIRED_BASE_ENV,
      'LOAD_TEST_CHECKOUT_BOOKING_ID',
      'LOAD_TEST_PRO_COOKIE',
    ],
    env: envRequiredAlias({
      publicName: 'LOAD_TEST_CHECKOUT_BOOKING_ID',
      childName: 'LOAD_TEST_BOOKING_ID',
    }),
  },
  {
    name: 'media-metadata',
    command: 'pnpm',
    args: ['test:load:media-metadata'],
    requiredEnv: [
      ...REQUIRED_BASE_ENV,
      'LOAD_TEST_MEDIA_BOOKING_ID',
      'LOAD_TEST_PRO_COOKIE',
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
    env: envRequiredAlias({
      publicName: 'LOAD_TEST_MEDIA_BOOKING_ID',
      childName: 'LOAD_TEST_BOOKING_ID',
    }),
  },
  {
    name: 'notifications',
    command: 'pnpm',
    args: ['test:load:notifications'],
    requiredEnv: [...REQUIRED_BASE_ENV],
    optionalEnv: ['INTERNAL_JOB_SECRET', 'CRON_SECRET'],
  },
  {
    name: 'stripe-webhook-replay',
    command: 'pnpm',
    args: ['test:load:stripe-webhook-replay'],
    requiredEnv: [...REQUIRED_BASE_ENV, 'STRIPE_WEBHOOK_SECRET'],
  },
{
  name: 'signup',
  command: 'pnpm',
  args: ['test:load:signup'],
  requiredEnv: [...REQUIRED_BASE_ENV, 'TURNSTILE_TEST_TOKEN'],
},
] as const

function nowRunId(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '')
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

function hasEnv(name: string): boolean {
  const value = process.env[name]?.trim()
  return Boolean(value)
}

function missingRequiredEnv(step: SuiteStep): string[] {
  return step.requiredEnv.filter((name) => !hasEnv(name))
}

function shouldSkipMissingEnv(): boolean {
  const raw = process.env.LOAD_TEST_SKIP_MISSING_ENV?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function shouldContinueOnFailure(): boolean {
  const raw = process.env.LOAD_TEST_CONTINUE_ON_FAILURE?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function formatDurationMs(value: number): number {
  return Math.round(value * 100) / 100
}

function commandPreview(step: SuiteStep): string {
  return [step.command, ...step.args].join(' ')
}

function runStep(step: SuiteStep): Promise<StepResult> {
  const startedAt = performance.now()

  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(step.env ?? {}),
      },
      shell: process.platform === 'win32',
    })

    child.on('error', () => {
      resolve({
        name: step.name,
        command: commandPreview(step),
        status: 'failed',
        exitCode: null,
        durationMs: formatDurationMs(performance.now() - startedAt),
        missingEnv: [],
      })
    })

    child.on('close', (code) => {
      resolve({
        name: step.name,
        command: commandPreview(step),
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: formatDurationMs(performance.now() - startedAt),
        missingEnv: [],
      })
    })
  })
}

function printStepHeader(step: SuiteStep, index: number, total: number): void {
  console.log('')
  console.log(
    `=== [${index}/${total}] ${step.name}: ${commandPreview(step)} ===`,
  )
}

function printMissingEnv(step: SuiteStep, missingEnv: string[]): void {
  console.error('')
  console.error(`Missing required env for ${step.name}:`)
  for (const name of missingEnv) {
    console.error(`- ${name}`)
  }
}

function buildSummary(args: {
  runId: string
  startedAtMs: number
  results: StepResult[]
}) {
  const totalDurationMs = formatDurationMs(performance.now() - args.startedAtMs)

  return {
    runId: args.runId,
    commit: readCommitSha(),
    environment: readEnvironmentName(),
    profile: process.env.LOAD_TEST_PROFILE ?? 'smoke',
    suite: 'launch-load',
    totalDurationMs,
    totals: {
      steps: args.results.length,
      passed: args.results.filter((result) => result.status === 'passed').length,
      failed: args.results.filter((result) => result.status === 'failed').length,
      skipped: args.results.filter((result) => result.status === 'skipped')
        .length,
    },
    results: args.results,
  }
}

function printSummaryAndSetExit(args: {
  runId: string
  startedAtMs: number
  results: StepResult[]
}): void {
  const summary = buildSummary(args)

  console.log('')
  console.log(JSON.stringify(summary, null, 2))

  if (summary.totals.failed > 0) {
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  const runId = nowRunId()
  const startedAtMs = performance.now()
  const continueOnFailure = shouldContinueOnFailure()
  const skipMissingEnv = shouldSkipMissingEnv()

  const results: StepResult[] = []

  console.log(
    JSON.stringify(
      {
        runId,
        commit: readCommitSha(),
        environment: readEnvironmentName(),
        profile: process.env.LOAD_TEST_PROFILE ?? 'smoke',
        suite: 'launch-load',
        steps: SUITE_STEPS.map((step) => ({
          name: step.name,
          command: commandPreview(step),
          requiredEnv: step.requiredEnv,
          optionalEnv: step.optionalEnv ?? [],
          childEnvOverrides: Object.keys(step.env ?? {}),
        })),
        controls: {
          continueOnFailure,
          skipMissingEnv,
        },
      },
      null,
      2,
    ),
  )

  for (const [index, step] of SUITE_STEPS.entries()) {
    printStepHeader(step, index + 1, SUITE_STEPS.length)

    const missingEnv = missingRequiredEnv(step)

    if (missingEnv.length > 0) {
      printMissingEnv(step, missingEnv)

      const result: StepResult = {
        name: step.name,
        command: commandPreview(step),
        status: skipMissingEnv ? 'skipped' : 'failed',
        exitCode: null,
        durationMs: 0,
        missingEnv,
      }

      results.push(result)

      if (!skipMissingEnv && !continueOnFailure) {
        printSummaryAndSetExit({
          runId,
          startedAtMs,
          results,
        })

        return
      }

      continue
    }

    const result = await runStep(step)
    results.push(result)

    if (result.status === 'failed' && !continueOnFailure) {
      printSummaryAndSetExit({
        runId,
        startedAtMs,
        results,
      })

      return
    }
  }

  printSummaryAndSetExit({
    runId,
    startedAtMs,
    results,
  })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})