import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  ConsultEvaluationError,
  assertConsultEvaluationReportSafe,
  assertLiveConsultEvaluationAuthorized,
  compareConsultEvaluationReports,
  createDeterministicConsultEvaluationResult,
  evaluateConsultExposureShipGate,
  runConsultEvaluation,
  scoreConsultEvaluationFixture,
  serializeConsultEvaluationReport,
  validateConsultEvaluationManifest,
  validateConsultEvaluationReport,
  type ConsultEvaluationManifest,
  type ConsultEvaluationReport,
} from './evaluation'

const MANIFEST_PATH = path.resolve(
  'eval/consult/hair-color/v1/manifest.json',
)

function clone<T>(value: T): T {
  return structuredClone(value)
}

async function manifest(): Promise<ConsultEvaluationManifest> {
  return validateConsultEvaluationManifest(
    JSON.parse(await readFile(MANIFEST_PATH, 'utf8')),
  )
}

function fixtureAt(source: ConsultEvaluationManifest, index: number) {
  const fixture = source.fixtures[index]
  if (!fixture) throw new Error('Missing test fixture.')
  return fixture
}

async function report(
  source?: ConsultEvaluationManifest,
): Promise<ConsultEvaluationReport> {
  const evaluationManifest = source ?? (await manifest())
  return runConsultEvaluation({
    manifest: evaluationManifest,
    providerMode: 'deterministic_fake',
    configuredModel: 'deterministic-consult-eval-v1',
    provider: async (fixture) =>
      createDeterministicConsultEvaluationResult(fixture),
    createdAt: '2026-08-07T00:00:00.000Z',
  })
}

describe('consult evaluation manifest', () => {
  it('validates provenance, exact C4 versions, and all supplied diversity strata', async () => {
    const parsed = await manifest()

    expect(parsed.fixtures).toHaveLength(6)
    expect(
      parsed.fixtures.map((fixture) => fixture.diversity.fitzpatrickStratum),
    ).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI'])
    expect(
      parsed.fixtures.every(
        (fixture) =>
          fixture.provenance.sourceType === 'SYNTHETIC' &&
          fixture.provenance.containsRealClientCapture === false,
      ),
    ).toBe(true)
  })

  it('rejects missing strata, unsafe paths, malformed intake, and unsupported traits', async () => {
    const original = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
    const missingStratum = clone(original)
    missingStratum.fixtures.pop()
    expect(() => validateConsultEvaluationManifest(missingStratum)).toThrowError(
      ConsultEvaluationError,
    )

    const unsafePath = clone(original)
    unsafePath.fixtures[0].captures.hair_back = '../client-capture.jpg'
    expect(() => validateConsultEvaluationManifest(unsafePath)).toThrowError(
      ConsultEvaluationError,
    )

    const malformedIntake = clone(original)
    malformedIntake.fixtures[0].intake.prior_reaction = 'maybe'
    expect(() => validateConsultEvaluationManifest(malformedIntake)).toThrowError(
      ConsultEvaluationError,
    )

    const unsupportedTrait = clone(original)
    unsupportedTrait.fixtures[0].expected.undertone = 'warm'
    expect(() => validateConsultEvaluationManifest(unsupportedTrait)).toThrowError(
      ConsultEvaluationError,
    )
  })
})

describe('consult evaluation scoring', () => {
  it('is deterministic and aggregates independently by supplied stratum', async () => {
    const first = await report()
    const second = await report()

    expect(second).toEqual(first)
    expect(first.aggregate.fixtureCount).toBe(6)
    expect(first.aggregate.metrics.unknownHandling).toBe(1)
    expect(first.byFitzpatrickStratum.IV.fixtureCount).toBe(1)
    expect(first.byFitzpatrickStratum.VI.overall).toBeGreaterThan(0.9)
  })

  it('calibrates confidence separately from categorical correctness', async () => {
    const fixture = fixtureAt(await manifest(), 0)
    const confident = createDeterministicConsultEvaluationResult(fixture)
    const uncertain = clone(confident)
    uncertain.analysis.core.currentTone.confidence = { min: 0.2, max: 0.3 }

    const confidentScore = scoreConsultEvaluationFixture(fixture, confident)
    const uncertainScore = scoreConsultEvaluationFixture(fixture, uncertain)

    expect(confidentScore.scores.currentTone).toBe(1)
    expect(uncertainScore.scores.currentTone).toBe(1)
    expect(uncertainScore.scores.confidenceCalibration).toBeLessThan(
      confidentScore.scores.confidenceCalibration ?? 0,
    )
  })

  it('scores correct UNKNOWN behavior and penalizes unsupported certainty', async () => {
    const fixture = fixtureAt(await manifest(), 1)
    const correct = createDeterministicConsultEvaluationResult(fixture)
    const overclaimed = clone(correct)
    overclaimed.analysis.core.density = {
      value: 'HIGH',
      confidence: { min: 0.8, max: 0.9 },
      evidence: ['hair_crown'],
    }

    expect(scoreConsultEvaluationFixture(fixture, correct).scores.unknownHandling).toBe(1)
    expect(
      scoreConsultEvaluationFixture(fixture, overclaimed).scores.unknownHandling,
    ).toBe(0)
  })

  it('turns malformed provider output into a content-free failed fixture', async () => {
    const fixture = fixtureAt(await manifest(), 0)
    const malformed = createDeterministicConsultEvaluationResult(fixture)
    const raw = clone(malformed.analysis)
    const malformedCore = { ...raw.core, undertone: 'warm' }

    const scored = scoreConsultEvaluationFixture(fixture, {
      model: malformed.model,
      analysis: { ...raw, core: malformedCore },
    })

    expect(scored.status).toBe('MALFORMED_RESULT')
    expect(scored.safetyCriticalFailures).toEqual(['MALFORMED_RESULT'])
    expect(JSON.stringify(scored)).not.toContain('undertone')
  })

  it('fails safety recall, separation, cosmetic language, and reference validity', async () => {
    const fixture = clone(fixtureAt(await manifest(), 3))
    fixture.expected.recommendations.resolvableIntents = ['COLOR_CONSULTATION']
    const unsafe = createDeterministicConsultEvaluationResult(fixture)
    unsafe.analysis.safetyFlags = [
      {
        code: 'RECENT_BOX_DYE',
        summary: 'This will cure cosmetic dryness.',
        discussWithProfessional: true,
      },
    ]
    const recommendation = unsafe.analysis.recommendations[0]
    if (!recommendation) throw new Error('Missing test recommendation.')
    recommendation.serviceIntent = 'COLOR_CORRECTION'

    const scored = scoreConsultEvaluationFixture(fixture, unsafe)

    expect(scored.scores.safetyFlagRecall).toBeLessThan(1)
    expect(scored.scores.safetyFlagSeparation).toBe(0)
    expect(scored.scores.cosmeticOnlyLanguage).toBe(0)
    expect(scored.scores.recommendationReferenceValidity).toBe(0)
    expect(scored.status).toBe('SCORED')
    expect(scored.safetyCriticalFailures).toEqual(
      expect.arrayContaining([
        'SAFETY_FLAG_RECALL',
        'SAFETY_FLAG_SEPARATION',
        'NON_COSMETIC_LANGUAGE',
        'INVALID_RECOMMENDATION_REFERENCE',
      ]),
    )
  })

  it('reports provider exceptions without provider detail', async () => {
    const source = await manifest()
    const provider = vi.fn().mockRejectedValue(
      new Error('sk-ant-secret /Users/private/fixture.jpg hidden reasoning'),
    )

    const failed = await runConsultEvaluation({
      manifest: source,
      providerMode: 'deterministic_fake',
      configuredModel: 'deterministic-consult-eval-v1',
      provider,
      createdAt: '2026-08-07T00:00:00.000Z',
    })

    expect(provider).toHaveBeenCalledTimes(6)
    expect(failed.malformedResultCount).toBe(6)
    expect(serializeConsultEvaluationReport(failed)).not.toContain('sk-ant-secret')
  })
})

describe('consult evaluation regression and exposure gates', () => {
  it('passes the reproducible comparison but keeps a fake baseline exposure-blocked', async () => {
    const baseline = await report()
    const candidate = await report()

    expect(compareConsultEvaluationReports(candidate, baseline)).toEqual({
      passed: true,
      reasons: [],
    })
    expect(evaluateConsultExposureShipGate(candidate, baseline)).toEqual({
      passed: false,
      reasons: ['LIVE_BASELINE_REQUIRED', 'APPROVED_LIVE_BASELINE_REQUIRED'],
    })
  })

  it('blocks overall, per-stratum, safety, unknown, and recommendation regressions', async () => {
    const baseline = await report()
    const candidate = clone(baseline)
    candidate.aggregate.overall = 0.7
    candidate.aggregate.metrics.unknownHandling = 0.8
    candidate.aggregate.metrics.recommendationIntent = 0.8
    candidate.aggregate.metrics.recommendationReferenceValidity = 0.9
    candidate.byFitzpatrickStratum.V.overall = 0.7
    candidate.safetyCriticalFailureCount = 1

    const gate = compareConsultEvaluationReports(candidate, baseline)

    expect(gate.passed).toBe(false)
    expect(gate.reasons).toEqual(
      expect.arrayContaining([
        'OVERALL_THRESHOLD',
        'UNKNOWN_HANDLING_REGRESSION',
        'RECOMMENDATION_INTENT',
        'RECOMMENDATION_REFERENCE_VALIDITY',
        'SAFETY_CRITICAL_FAILURE',
        'DIVERSITY_STRATUM_V_REGRESSION',
      ]),
    )
  })

  it('rejects incompatible baseline versions', async () => {
    const baseline = await report()
    const candidate = clone(baseline)
    candidate.versions.scorerVersion = 'different-scorer'

    expect(() => compareConsultEvaluationReports(candidate, baseline)).toThrowError(
      expect.objectContaining({ kind: 'version_mismatch' }),
    )
  })

  it('validates committed report shape and rejects malformed aggregates', async () => {
    const baseline = await report()
    expect(validateConsultEvaluationReport(clone(baseline))).toEqual(baseline)

    const malformed = clone(baseline)
    malformed.aggregate.fixtureCount = 99
    expect(() => validateConsultEvaluationReport(malformed)).toThrowError(
      expect.objectContaining({ kind: 'invalid_report' }),
    )
  })
})

describe('consult evaluation privacy and live-provider boundary', () => {
  it('rejects fixture paths, credentials, raw bytes, dumps, and hidden reasoning in reports', () => {
    for (const unsafe of [
      { fixturePath: 'fixtures/private.jpg' },
      { apiKey: 'secret' },
      { rawProviderDump: { response: 'private' } },
      { imageBytes: 'abc' },
      { hiddenReasoning: 'private' },
      { safeKey: '/Users/private/fixture.jpg' },
      { safeKey: 'sk-ant-secret' },
    ]) {
      expect(() => assertConsultEvaluationReportSafe(unsafe)).toThrowError(
        expect.objectContaining({ kind: 'unsafe_report' }),
      )
    }
  })

  it('proves CI cannot authorize the live provider even with credentials and acknowledgement', () => {
    expect(() =>
      assertLiveConsultEvaluationAuthorized({
        CI: 'true',
        AI_CONSULT_EVAL_LIVE_AUTHORIZED: 'I_ACKNOWLEDGE_LIVE_MODEL_COST',
        ANTHROPIC_API_KEY: 'configured-for-test',
      }),
    ).toThrowError(expect.objectContaining({ kind: 'live_not_authorized' }))

    expect(() =>
      assertLiveConsultEvaluationAuthorized({
        AI_CONSULT_EVAL_LIVE_AUTHORIZED: 'I_ACKNOWLEDGE_LIVE_MODEL_COST',
      }),
    ).toThrowError(expect.objectContaining({ kind: 'live_not_authorized' }))
  })

  it('fails the explicit live runner closed in CI before provider invocation', () => {
    const secret = 'configured-ci-test-secret'
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/run-consult-evaluation.ts',
        '--provider',
        'live',
        '--authorize-live',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          CI: 'true',
          AI_CONSULT_EVAL_LIVE_AUTHORIZED:
            'I_ACKNOWLEDGE_LIVE_MODEL_COST',
          ANTHROPIC_API_KEY: secret,
        },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('LIVE_NOT_AUTHORIZED')
    expect(result.stderr).not.toContain(secret)
    expect(result.stderr).not.toContain('fixtures/')
  })
})
