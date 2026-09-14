// scripts/dev/crown-level-experiment.ts
//
// Does the CROWN view move `baseLevel` / `lightestLevel` in the reader that
// actually ships?
//
// Why this script exists. The depth bench of 2026-09-14
// (docs/consult/depth-bench-2026-09-14/round2-results.json) found that almost
// the whole level error is the overhead crown shot: 1.92 levels out and
// systematically too dark, against 0.67 on hair_left and 0.83 on hair_right.
// But that measurement was taken with the INSPIRATION reader
// (`inspiration-hair-color-v5`) fed one view at a time. In production the
// reader that sees a view LABELLED `hair_crown` is the analysis engine, and it
// sees all seven shots at once and returns ONE pair of levels. A per-view bias
// in a single-image reader does not automatically survive into a reader that
// can compare the crown against three other views in the same call. So the
// bench's recommendation is a hypothesis about production, not a finding about
// it, and this script is what turns one into the other.
//
// It deliberately does NOT modify `runConsultAnalysis`. The two calls are
// reassembled here from the pieces analysisEngine.ts already exports, so a
// variant prompt can be measured without the shipped prompt constant — and the
// version pinned in the database next to it — ever changing.
//
// The profile call is made ONCE per fixture per run and shared by every
// variant that was given the same images. The feature profile carries no hair
// level (CONSULT_PROFILE_FIELDS is twelve cosmetic observations, none of them
// a depth), so sharing it costs no fidelity, halves the spend, and removes
// profile-to-profile variance as a confound between variants.
//
// Live model calls cost money. Nothing here writes to a database: no meter
// sink is passed, exactly as the sanctioned eval runner does it.
//
//   npx dotenv -e .env.local -- npx tsx scripts/dev/crown-level-experiment.ts \
//     --runs 3 --out /tmp/crown.json

import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type Anthropic from '@anthropic-ai/sdk'
import { ConsultProviderCallKind } from '@prisma/client'

import {
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
  CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
  CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS,
  CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
  CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
  CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS,
  buildConsultDirectionOutputSchema,
  buildConsultProfileOutputSchema,
  consultAnalysisContextBlocks,
  consultDirectionContextBlocks,
  consultProfileBlock,
  consultProfileContextBlocks,
  requestConsultAnalysisJson,
  sanitizeConsultDirectionResponse,
  sanitizeConsultProfileResponse,
  type ConsultAnalysisInput,
} from '@/lib/consult/analysisEngine'
import {
  CONSULT_CAPTURE_MEDIA_TYPES,
  type ConsultCaptureMediaType,
} from '@/lib/consult/captureVision'
import {
  HAIR_COLOR_CAPTURE_PACK_ID,
  HAIR_COLOR_CAPTURE_SHOT_KEYS,
} from '@/lib/consult/capturePack'
import { HAIR_COLOR_INTAKE_PACK_ID } from '@/lib/consult/intake/packs/hairColor'
import { deriveConsultSafetyFlagPolicy } from '@/lib/consult/safetyFlags'
import type { ConsultCaptureShotKeyDTO } from '@/lib/dto/consult'

const MANIFEST_PATH = 'eval/consult/hair-color/v1/manifest.json'

/**
 * The candidate fix. One sentence appended to the DIRECTION system prompt,
 * nothing else changed.
 *
 * It says what the measurement says and no more: the overhead shot's exposure
 * is not trustworthy for depth (both readers agree it is anomalous, and they
 * disagree about the DIRECTION of the anomaly — the model reads it dark, Tori
 * reads it light), while the crown remains the view that shows density and the
 * parting. It does not remove `hair_crown` from the evidence grammar, so the
 * model can still cite it when it is genuinely the only hair view supplied.
 */
const CROWN_GUIDANCE =
  ' The hair_crown view looks down at the top of the head. It is lit from above, so its hair reads brighter and more specular than the same head does from the side, and its exposure is not a reliable measure of depth. Read baseLevel and lightestLevel from hair_back, hair_left and hair_right where any of those was supplied, and use hair_crown for what the overhead angle genuinely shows — density and the parting. Cite hair_crown for a level only when it is the only hair view you were given, and keep the confidence range low when you do.'

type VariantName = 'control' | 'crown_guidance'

type Fixture = {
  id: string
  captures: Record<string, string>
  captureMediaType: ConsultCaptureMediaType
  intake: Record<string, string>
}

function asMediaType(value: unknown): ConsultCaptureMediaType {
  for (const mediaType of CONSULT_CAPTURE_MEDIA_TYPES) {
    if (value === mediaType) return mediaType
  }
  throw new Error(`fixture media type is not one this pipeline accepts: ${String(value)}`)
}

type RunRecord = {
  fixture: string
  run: number
  variant: VariantName
  baseLevel: string
  baseEvidence: readonly string[]
  lightestLevel: string
  lightestEvidence: readonly string[]
}

function parseArgs(argv: readonly string[]) {
  let runs = 3
  let out: string | null = null
  let only: string[] | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--runs' && value) { runs = Number.parseInt(value, 10); index += 1 }
    else if (flag === '--out' && value) { out = value; index += 1 }
    else if (flag === '--fixtures' && value) { only = value.split(','); index += 1 }
    else throw new Error(`unknown argument: ${flag}`)
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
  return { runs, out, only }
}

function isRecordOf(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadFixtures(manifestPath: string): Promise<{ fixtures: Fixture[]; requestedModel: string }> {
  const raw: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!isRecordOf(raw) || !Array.isArray(raw.fixtures) || typeof raw.requestedModel !== 'string') {
    throw new Error('manifest is not the shape this script expects')
  }
  const fixtures = raw.fixtures.map((entry): Fixture => {
    if (
      !isRecordOf(entry) ||
      typeof entry.id !== 'string' ||
      !isRecordOf(entry.captures) ||
      typeof entry.captureMediaType !== 'string' ||
      !isRecordOf(entry.intake)
    ) {
      throw new Error('fixture is not the shape this script expects')
    }
    const captures: Record<string, string> = {}
    for (const [key, value] of Object.entries(entry.captures)) {
      if (typeof value !== 'string') throw new Error('capture path is not a string')
      captures[key] = value
    }
    const intake: Record<string, string> = {}
    for (const [key, value] of Object.entries(entry.intake)) {
      if (typeof value !== 'string') throw new Error('intake answer is not a string')
      intake[key] = value
    }
    return { id: entry.id, captures, captureMediaType: asMediaType(entry.captureMediaType), intake }
  })
  return { fixtures, requestedModel: raw.requestedModel }
}

/** The same capture set the sanctioned eval runner builds, minus the metering. */
async function buildInput(manifestPath: string, fixture: Fixture): Promise<ConsultAnalysisInput> {
  const manifestDirectory = await realpath(path.dirname(manifestPath))
  const captures: ConsultAnalysisInput['captures'][number][] = []
  for (const shotKey of HAIR_COLOR_CAPTURE_SHOT_KEYS) {
    const relative = fixture.captures[shotKey]
    if (!relative) throw new Error(`fixture ${fixture.id} is missing ${shotKey}`)
    const resolved = await realpath(path.resolve(manifestDirectory, relative))
    if (!resolved.startsWith(`${manifestDirectory}${path.sep}`)) {
      throw new Error('fixture path escapes the manifest directory')
    }
    captures.push({
      shotKey: shotKey as ConsultCaptureShotKeyDTO,
      image: {
        mediaType: fixture.captureMediaType,
        base64: (await readFile(resolved)).toString('base64'),
      },
      qualityWarningCode: null,
    })
  }
  return {
    service: { family: 'HAIR', categoryName: 'Color', serviceName: null, menuServiceNames: [] },
    capturePack: { id: HAIR_COLOR_CAPTURE_PACK_ID, shotKeys: [...HAIR_COLOR_CAPTURE_SHOT_KEYS] },
    intake: fixture.intake,
    intakeItems: [],
    captures,
    inspiration: { source: 'NONE', analysis: null, answers: [], wants: [], avoids: [], unsure: [], keep: [] },
    safetyCodes: [
      ...deriveConsultSafetyFlagPolicy({
        intakePackId: HAIR_COLOR_INTAKE_PACK_ID,
        intake: fixture.intake,
        visibleCondition: 'UNKNOWN',
      }).supported,
    ],
  }
}

/** A local copy of the engine's private image builder — same order, same labels. */
function imageContent(input: ConsultAnalysisInput): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = []
  for (const capture of input.captures) {
    content.push({ type: 'text', text: `Evidence label: ${capture.shotKey}` })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: capture.image.mediaType, data: capture.image.base64 },
    })
  }
  return content
}

/**
 * The direction call routinely lands at 73-84s against its 90s ceiling, and a
 * provider failure surfaces as `unavailable` whatever caused it. A lost cell
 * is worse than a retried one here: the control/variant comparison is PAIRED,
 * so one dropped call silently removes its partner from the comparison too.
 */
async function withRetry<T>(attempts: number, call: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5_000))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function main(): Promise<void> {
  const { runs, out, only } = parseArgs(process.argv.slice(2))
  const manifestPath = path.resolve(MANIFEST_PATH)
  const { fixtures: allFixtures, requestedModel } = await loadFixtures(manifestPath)
  const fixtures = only ? allFixtures.filter((entry) => only.includes(entry.id)) : allFixtures
  if (fixtures.length === 0) throw new Error('no fixtures matched')

  const model = process.env.AI_CONSULT_ANALYSIS_MODEL ?? CONSULT_ANALYSIS_DEFAULT_MODEL
  if (model !== requestedModel) {
    throw new Error(`model ${model} does not match the manifest's ${requestedModel}`)
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')

  const records: RunRecord[] = []
  const failures: Array<{ fixture: string; run: number; variant: string; error: string }> = []

  for (const fixture of fixtures) {
    const input = await buildInput(manifestPath, fixture)
    const images = imageContent(input)
    const blocks = consultAnalysisContextBlocks(input)
    const suppliedShotKeys = input.captures.map((capture) => capture.shotKey)

    for (let run = 1; run <= runs; run += 1) {
      // One profile per fixture-run, shared by both variants: identical images,
      // and the profile carries no hair level to bias either direction call.
      let profileBlock: string
      try {
        const featureRead = await withRetry(2, () => requestConsultAnalysisJson({
          model,
          system: CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
          content: [
            ...images,
            ...consultProfileContextBlocks(blocks).map((text): Anthropic.ContentBlockParam => ({ type: 'text', text })),
          ],
          schema: buildConsultProfileOutputSchema({ suppliedShotKeys, includeStyleDirections: false }),
          maxTokens: CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
          timeoutMs: CONSULT_ANALYSIS_PROFILE_TIMEOUT_MS,
          kind: ConsultProviderCallKind.ANALYSIS_PROFILE,
        }))
        profileBlock = consultProfileBlock(sanitizeConsultProfileResponse(featureRead))
      } catch (error) {
        failures.push({
          fixture: fixture.id,
          run,
          variant: 'profile',
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      const variants: ReadonlyArray<{ name: VariantName; system: string }> = [
        { name: 'control', system: CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT },
        { name: 'crown_guidance', system: CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT + CROWN_GUIDANCE },
      ]

      for (const variant of variants) {
        try {
          const directionRead = await withRetry(2, () => requestConsultAnalysisJson({
            model,
            system: variant.system,
            content: [
              ...images,
              ...consultDirectionContextBlocks(blocks).map((text): Anthropic.ContentBlockParam => ({ type: 'text', text })),
              { type: 'text', text: profileBlock },
            ],
            schema: buildConsultDirectionOutputSchema({
              menuServiceNames: input.service.menuServiceNames,
              safetyCodes: input.safetyCodes,
              suppliedShotKeys,
            }),
            maxTokens: CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
            timeoutMs: CONSULT_ANALYSIS_DIRECTION_TIMEOUT_MS,
            kind: ConsultProviderCallKind.ANALYSIS_DIRECTION,
          }))
          const { core } = sanitizeConsultDirectionResponse(directionRead, {
            menuServiceNames: input.service.menuServiceNames,
          })
          records.push({
            fixture: fixture.id,
            run,
            variant: variant.name,
            baseLevel: core.baseLevel.value,
            baseEvidence: [...core.baseLevel.evidence],
            lightestLevel: core.lightestLevel.value,
            lightestEvidence: [...core.lightestLevel.evidence],
          })
          process.stdout.write(
            `${fixture.id} run ${run} ${variant.name}: base ${core.baseLevel.value} [${core.baseLevel.evidence.join(',')}] lightest ${core.lightestLevel.value} [${core.lightestLevel.evidence.join(',')}]\n`,
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          failures.push({ fixture: fixture.id, run, variant: variant.name, error: message })
          process.stdout.write(`${fixture.id} run ${run} ${variant.name}: FAILED ${message}\n`)
        }
      }
    }
  }

  const payload = JSON.stringify(
    { createdAt: new Date().toISOString(), model, runs, crownGuidance: CROWN_GUIDANCE, records, failures },
    null,
    2,
  )
  if (out) {
    await writeFile(path.resolve(out), payload)
    process.stdout.write(`\nwrote ${records.length} records and ${failures.length} failures to ${out}\n`)
  } else {
    process.stdout.write(payload)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`crown experiment failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
