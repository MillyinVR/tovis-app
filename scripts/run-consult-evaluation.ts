import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  runConsultAnalysis,
} from '@/lib/consult/analysisEngine'
import { HAIR_COLOR_CAPTURE_SHOT_KEYS } from '@/lib/consult/capturePack'
import {
  ConsultEvaluationError,
  assertLiveConsultEvaluationAuthorized,
  compareConsultEvaluationReports,
  createDeterministicConsultEvaluationResult,
  evaluateConsultExposureShipGate,
  runConsultEvaluation,
  serializeConsultEvaluationReport,
  validateConsultEvaluationManifest,
  validateConsultEvaluationReport,
  type ConsultEvaluationFixture,
  type ConsultEvaluationProvider,
  type EvaluationProviderMode,
} from '@/lib/consult/evaluation'

const DEFAULT_MANIFEST = 'eval/consult/hair-color/v1/manifest.json'

type RunnerOptions = {
  manifestPath: string
  providerMode: EvaluationProviderMode
  outputPath: string | null
  baselinePath: string | null
  authorizeLive: boolean
  createdAt: string | null
}

function parseOptions(argv: readonly string[]): RunnerOptions {
  const options: RunnerOptions = {
    manifestPath: DEFAULT_MANIFEST,
    providerMode: 'deterministic_fake',
    outputPath: null,
    baselinePath: null,
    authorizeLive: false,
    createdAt: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--authorize-live') {
      options.authorizeLive = true
      continue
    }
    const value = argv[index + 1]
    if (!value) throw new ConsultEvaluationError('invalid_manifest')
    if (argument === '--manifest') options.manifestPath = value
    else if (argument === '--output') options.outputPath = value
    else if (argument === '--compare') options.baselinePath = value
    else if (argument === '--created-at') options.createdAt = value
    else if (argument === '--provider') {
      if (value !== 'fake' && value !== 'live') {
        throw new ConsultEvaluationError('invalid_manifest')
      }
      options.providerMode = value === 'live' ? 'live' : 'deterministic_fake'
    } else {
      throw new ConsultEvaluationError('invalid_manifest')
    }
    index += 1
  }
  if (options.providerMode === 'live' && options.createdAt) {
    throw new ConsultEvaluationError('live_not_authorized')
  }
  return options
}

async function loadJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    throw new ConsultEvaluationError('invalid_manifest')
  }
}

async function liveProvider(
  manifestPath: string,
  fixture: ConsultEvaluationFixture,
) {
  const manifestDirectory = await realpath(path.dirname(manifestPath))
  const captures = []
  for (const shotKey of HAIR_COLOR_CAPTURE_SHOT_KEYS) {
    const resolved = await realpath(
      path.resolve(manifestDirectory, fixture.captures[shotKey]),
    )
    if (!resolved.startsWith(`${manifestDirectory}${path.sep}`)) {
      throw new ConsultEvaluationError('invalid_manifest')
    }
    captures.push({
      shotKey,
      image: {
        mediaType: fixture.captureMediaType,
        base64: (await readFile(resolved)).toString('base64'),
      },
    })
  }
  // The corpus is the founder pilot's colour set with no professional menu:
  // the provider sees the colour category and can name only the consultation.
  return runConsultAnalysis({
    service: {
      family: 'HAIR',
      categoryName: 'Color',
      serviceName: null,
      menuServiceNames: [],
    },
    intake: fixture.intake,
    intakeItems: [],
    captures,
  })
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const manifestPath = path.resolve(options.manifestPath)
  const manifest = validateConsultEvaluationManifest(await loadJson(manifestPath))

  let configuredModel = 'deterministic-consult-eval-v1'
  let provider: ConsultEvaluationProvider = async (fixture) =>
    createDeterministicConsultEvaluationResult(fixture)
  if (options.providerMode === 'live') {
    if (!options.authorizeLive) {
      throw new ConsultEvaluationError('live_not_authorized')
    }
    assertLiveConsultEvaluationAuthorized({
      CI: process.env.CI,
      AI_CONSULT_EVAL_LIVE_AUTHORIZED:
        process.env.AI_CONSULT_EVAL_LIVE_AUTHORIZED,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    })
    if (
      manifest.fixtures.some(
        (fixture) => fixture.provenance.reviewStatus !== 'DOMAIN_REVIEWED',
      )
    ) {
      throw new ConsultEvaluationError('live_not_authorized')
    }
    configuredModel =
      process.env.AI_CONSULT_ANALYSIS_MODEL ?? CONSULT_ANALYSIS_DEFAULT_MODEL
    if (configuredModel !== manifest.requestedModel) {
      throw new ConsultEvaluationError('version_mismatch')
    }
    provider = (fixture) => liveProvider(manifestPath, fixture)
  }

  const report = await runConsultEvaluation({
    manifest,
    providerMode: options.providerMode,
    configuredModel,
    provider,
    createdAt: options.createdAt ?? new Date().toISOString(),
  })
  const serialized = serializeConsultEvaluationReport(report)
  if (options.outputPath) await writeFile(path.resolve(options.outputPath), serialized)
  else process.stdout.write(serialized)

  if (options.baselinePath) {
    const baseline = validateConsultEvaluationReport(
      await loadJson(path.resolve(options.baselinePath)),
    )
    const comparison = compareConsultEvaluationReports(report, baseline)
    const shipGate = evaluateConsultExposureShipGate(report, baseline)
    process.stdout.write(
      `Evaluation comparison: ${comparison.passed ? 'PASS' : 'FAIL'}; exposure ship gate: ${shipGate.passed ? 'PASS' : 'BLOCKED'}.\n`,
    )
    if (!comparison.passed) process.exitCode = 1
  } else if (options.outputPath) {
    process.stdout.write(
      `Evaluation complete: ${report.aggregate.overall.toFixed(4)} (${report.providerMode}).\n`,
    )
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof ConsultEvaluationError
      ? error.kind.toUpperCase()
      : 'UNEXPECTED_FAILURE'
  process.stderr.write(`Consult evaluation failed (${code}).\n`)
  process.exitCode = 1
})
