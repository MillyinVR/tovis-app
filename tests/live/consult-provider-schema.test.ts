// tests/live/consult-provider-schema.test.ts
//
// 🔴 The one test in this repo that would have caught the bug it exists for.
//
// `runConsultAnalysis` shipped for two schema versions unable to make a single
// successful request. Its `output_config.format.schema` was refused by the
// Messages API — first for keywords the structured-output validator does not
// accept (`minimum`/`maximum`, `maxItems`/`uniqueItems`, `minItems: 7`), then,
// after those were stripped, for the size of the compiled grammar. Every
// consult test mocked the provider, so the suite was green the whole time and
// the only symptom in production was CONSULT_ANALYSIS_UNAVAILABLE.
//
// A mock cannot fail that way. So this suite sends THE schemas this repo would
// send — built by the same functions, sanitized by the same boundary — to the
// real endpoint, with real images, and asserts the call comes back 200 and the
// answer parses through the real sanitizers.
//
// It costs money and needs a third party to be up, so it is not a PR gate: it
// runs nightly and on demand (.github/workflows/live-model-contract.yml).
// `pnpm test:live:consult-schema`.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import Anthropic from '@anthropic-ai/sdk'
import { Prisma } from '@prisma/client'
import type { ConsultProMenuOffering } from '@/lib/consult/proMenu'
import { CONSULT_LOOK_PLAN_INSTRUCTIONS, consultLookPlanMenuContext } from '@/lib/consult/lookPlan'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildConsultDirectionOutputSchema,
  buildConsultProfileOutputSchema,
  CONSULT_ANALYSIS_DEFAULT_MODEL,
  CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
  CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
  CONSULT_ANALYSIS_EFFORT,
  CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
  CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
  sanitizeConsultDirectionResponse,
  runConsultFaceColorCompanion,
  sanitizeConsultProfileResponse,
  sanitizeConsultProfileAndStylesResponse,
  CONSULT_STYLE_GUIDANCE,
  runConsultAnalysis,
  validateConsultAnalysisProviderResult,
} from '@/lib/consult/analysisEngine'
import {
  CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
  CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
  CONSULT_INSPIRATION_MAX_TOKENS,
  ConsultInspirationVisionError,
  sanitizeLocalizedInspirationAnalysis,
} from '@/lib/consult/inspirationVision'
import {
  buildConsultFollowUpOutputSchema,
  CONSULT_FOLLOW_UP_EFFORT,
  CONSULT_FOLLOW_UP_MAX_QUESTIONS,
  CONSULT_FOLLOW_UP_MAX_TOKENS,
  CONSULT_FOLLOW_UP_SYSTEM_PROMPT,
  sanitizeConsultFollowUpQuestions,
} from '@/lib/consult/followUpEngine'
import { defaultClientConsultInspirationCopy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import {
  consultStartingPointPhrase,
  renderConsultFollowUpContext,
} from '@/lib/consult/followUpContext'
import type { ConsultAnalysisCore } from '@/lib/consult/analysisEngine'
import type {
  ConsultAnalysisEvidenceDTO,
  ConsultInspirationAnalysisAttributesDTO,
  ConsultInspirationAnalysisObservationDTO,
} from '@/lib/dto/consult'
import type {
  ConsultFollowUpVocabulary,
  ConsultFollowUpVocabularyEntry,
} from '@/lib/consult/followUpVocabulary'
import { toProviderOutputSchema } from '@/lib/consult/providerSchema'
import { runConsultSuitability } from '@/lib/consult/suitabilityRuntime'
import { syntheticSuitabilityInput } from '@/tests/fixtures/consultSuitability'
import {
  buildConsultSuitabilityContext, sanitizeConsultSuitabilityResponse,
} from '@/lib/consult/suitabilityTranslation'

/**
 * The eval fixtures: synthetic, committed, and the only images in this repo
 * that are safe to send anywhere (prod media is clients' private session
 * photos). Enough of a head of hair for the model to answer about.
 */
const FIXTURES = path.join(process.cwd(), 'eval/consult/hair-color/v1/fixtures')

function fixture(name: string): { base64: string; mediaType: 'image/jpeg' } {
  return {
    base64: readFileSync(path.join(FIXTURES, `${name}.jpg`)).toString('base64'),
    mediaType: 'image/jpeg',
  }
}

const MENU = ['Full balayage', 'Root touch-up', 'Toner gloss'] as const

/**
 * What the hair-colour intake below can support. The provider's `code` enum is
 * narrowed to this per run — a code outside it is a fabricated concern that
 * would cost the whole analysis (lib/consult/safetyFlags.ts).
 */
const SAFETY_CODES = ['ALLERGY_HISTORY_UNKNOWN'] as const

const SHOT_KEYS = [
  'hair_back',
  'hair_left',
  'hair_right',
  'hair_crown',
  'face_front',
  'face_side',
  'eyes_closeup',
] as const

let client: Anthropic

beforeAll(() => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  // Fail, never skip. A silently skipped live test is exactly the "green suite,
  // broken schema" state this file exists to make impossible.
  if (!apiKey) {
    throw new Error(
      'tests/live needs ANTHROPIC_API_KEY. This suite makes real provider calls by design.',
    )
  }
  client = new Anthropic({ apiKey, maxRetries: 0 })
})

const model = () =>
  process.env.AI_CONSULT_ANALYSIS_MODEL ?? CONSULT_ANALYSIS_DEFAULT_MODEL

type Content = Anthropic.ContentBlockParam[]

function labeledImages(): Content {
  const content: Content = []
  for (const shotKey of SHOT_KEYS) {
    const image = fixture(`synthetic-i-${shotKey}`)
    content.push({ type: 'text', text: `Evidence label: ${shotKey}` })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    })
  }
  return content
}

/**
 * One structured-output request, with the failure surfaced rather than
 * swallowed. `runConsultAnalysis` maps every provider error to `unavailable`
 * — correct in production, useless here, where the 400's own words ("the
 * compiled grammar is too large") are the finding.
 */
let responseSequence = 0

async function send(args: {
  system: string
  content: Content
  schema: Record<string, unknown>
  maxTokens: number
  /** Defaults to the analysis calls' level; the follow-up sets its own. */
  effort?: 'low' | 'medium' | 'high'
}): Promise<unknown> {
  let message: Anthropic.Message
  try {
    message = await client.messages.create({
      model: model(),
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: 'user', content: args.content }],
      output_config: {
        // Production's effort level, not a level typed here — the two calls'
        // token and latency behaviour is entirely different at the default.
        effort: args.effort ?? CONSULT_ANALYSIS_EFFORT,
        format: { type: 'json_schema', schema: toProviderOutputSchema(args.schema) },
      },
    })
  } catch (error) {
    throw new Error(
      `the provider refused this schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  expect(message.stop_reason).not.toBe('refusal')
  // A truncated answer is not a parse failure to debug later: it means
  // max_tokens is below what this schema needs, and the production call would
  // fail the same way.
  expect(message.stop_reason).not.toBe('max_tokens')
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
  expect(text).not.toBe('')
  if (process.env.CONSULT_LIVE_ARTIFACT_DIR) writeFileSync(path.join(process.env.CONSULT_LIVE_ARTIFACT_DIR, `consult-schema-response-${++responseSequence}.json`), text)
  return JSON.parse(text) as unknown
}

describe('the consult schemas compile and answer against the live model', () => {
  it.each([false, true])('C2-2 — dual-language suitability contract answers (unknown observations: %s)', async unknown => {
    const input = syntheticSuitabilityInput()
    if (unknown) {
      input.faceColor = undefined
      input.analysis.profile.skinUndertone = { value: 'UNKNOWN', confidence: { min: 0, max: 0.35 }, evidence: [] }
    }
    const context = buildConsultSuitabilityContext(input)
    const { raw } = await runConsultSuitability({ context })
    const result = sanitizeConsultSuitabilityResponse(raw, context)
    expect(result.whatYouLoved.map(source => source.value)).toEqual(input.clientChoices.slice(0, 2).map(choice => choice.clientWords))
    expect(result.tailoring.length).toBeGreaterThan(0)
    expect(result.proConfirmations.length).toBeGreaterThan(0)
    if (unknown) expect(result.tailoring.every(item => item.status === 'NEEDS_PRO_CONFIRMATION')).toBe(true)
  })

  it('call 1 — the feature profile schema returns a payload the sanitizer accepts', async () => {
    const raw = await send({
      system: CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT,
      content: [
        ...labeledImages(),
        {
          type: 'text',
          text: [
            'Consultation context:',
            'Capture pack: hair-color-daylight (views: ' + SHOT_KEYS.join(', ') + ')',
            'Service family: Hair',
            'Service category: Color',
            'Service the client is considering: Full balayage',
          ].join('\n'),
        },
        { type: 'text', text: 'Client intake: no answers.' },
      ],
      schema: buildConsultProfileOutputSchema({ suppliedShotKeys: [...SHOT_KEYS] }),
      // 🔴 THE constant production sends, never a number typed here. The first
      // live run of this file hardcoded 5,000 for the direction call and
      // truncated on exactly that boundary — a cap the real caller did not
      // have, which is a test failing on its own fixture rather than on the
      // contract it exists to check.
      maxTokens: CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
    })

    const profile = sanitizeConsultProfileResponse(raw)
    expect(Object.keys(profile)).toHaveLength(12)
    for (const observation of Object.values(profile)) {
      expect(Object.keys(observation).sort()).toEqual([
        'confidence',
        'evidence',
        'value',
      ])
      expect(observation.confidence.min).toBeLessThan(observation.confidence.max)
    }
  })

  it('C2-1 — the companion face/color schema compiles and returns a sanitizable payload', async () => {
    // Exercise the actual paid companion path, including its narrowed images,
    // prompt, timeout, sanitizer and supplied-evidence check. No fallback here:
    // the required-success contract must fail when the provider cannot answer.
    const profile = await runConsultFaceColorCompanion({
      service: { family: 'HAIR', categoryName: 'Color', serviceName: 'Full balayage', menuServiceNames: MENU },
      intake: {}, intakeItems: [],
      capturePack: { id: 'hair-color-daylight', shotKeys: SHOT_KEYS },
      captures: SHOT_KEYS.map(shotKey => ({ shotKey, image: fixture(`synthetic-i-${shotKey}`), qualityWarningCode: null })),
      inspiration: { source: 'NONE', analysis: null, answers: [], wants: [], avoids: [], unsure: [], keep: [] },
      safetyCodes: SAFETY_CODES,
    })
    expect(Object.keys(profile)).toHaveLength(9)
    for (const observation of Object.values(profile)) {
      expect(observation.confidence.min).toBeLessThan(observation.confidence.max)
    }
  })

  it('result-first hair plan — real schema separates the desired color and shape from an extensions reference', async () => {
    const profileWithStyles = sanitizeConsultProfileAndStylesResponse(await send({
      system: CONSULT_ANALYSIS_PROFILE_SYSTEM_PROMPT + ' Also provide styleDirections. ' + CONSULT_STYLE_GUIDANCE.join(' '),
      content: [...labeledImages(), { type: 'text', text: 'Observe this client only. Unclear features stay UNKNOWN.' }],
      schema: buildConsultProfileOutputSchema({ suppliedShotKeys: SHOT_KEYS, includeStyleDirections: true }),
      maxTokens: CONSULT_ANALYSIS_PROFILE_MAX_TOKENS,
    }))
    const menu: ConsultProMenuOffering[] = [
      ['Extensions', 'Adds length and fullness using additional hair.'],
      ['Dimensional color', 'Creates lighter pieces and a blended warm tone in the existing hair.'],
      ['Layered cut', 'Shapes movement with layers while preserving the requested length.'],
    ].map(([name, description], index) => ({
      id: `offering-${index}`, serviceId: `service-${index}`,
      offersInSalon: true, offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal(200), salonDurationMinutes: 120,
      mobilePriceStartingAt: null, mobileDurationMinutes: null,
      service: { name: name!, description: description!, categoryId: `category-${index}`, defaultDurationMinutes: 120 },
    }))
    const lookPlanContext = { menu, ...profileWithStyles }
    const raw = await send({
      system: CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT + ' ' + CONSULT_LOOK_PLAN_INSTRUCTIONS,
      content: [...labeledImages(), { type: 'text', text: [
        'The reference was tagged Extensions. That is context about the photo, not the client’s desired work.',
        'Client goal: I love the warm dimension and soft layers. Keep my own length. I do NOT want extensions or added length.',
        'Client reports: natural hair, no prior chemical color, no previous lightening, no prior reactions; moderate upkeep is comfortable.',
        'Allergy history and budget are unknown. Confirm any uncertain photo observations rather than inventing them.',
        `Professional menu data: ${consultLookPlanMenuContext(menu)}`,
        `Observed client profile: ${JSON.stringify(profileWithStyles.profile)}`,
      ].join('\n') }],
      schema: buildConsultDirectionOutputSchema({ menuServiceNames: menu.map(item => item.service.name), safetyCodes: SAFETY_CODES, suppliedShotKeys: SHOT_KEYS, lookPlanContext }),
      maxTokens: CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
    })
    const output = sanitizeConsultDirectionResponse(raw, { menuServiceNames: menu.map(item => item.service.name), lookPlanContext })
    expect(output.lookPlan?.summary).toBeTruthy()
    expect(output.lookPlan?.nextStep).toBeTruthy()
    expect(output.lookPlan?.paths.flatMap(path => path.visits.flatMap(visit => visit.services))).not.toContain('Extensions')
    expect(output.lookPlan?.paths.length).toBeLessThanOrEqual(3)
  })

  it('call 2 — the direction schema returns a payload the sanitizer accepts', async () => {
    const raw = await send({
      system: CONSULT_ANALYSIS_DIRECTION_SYSTEM_PROMPT,
      content: [
        ...labeledImages(),
        {
          type: 'text',
          text: [
            'Consultation context:',
            'Capture pack: hair-color-daylight (views: ' + SHOT_KEYS.join(', ') + ')',
            'Service family: Hair',
            'Service category: Color',
            'Service the client is considering: Full balayage',
            `Professional's menu in this category (recommend only these, named exactly): ${MENU.join('; ')}`,
          ].join('\n'),
        },
        {
          type: 'text',
          text: 'Client intake (question → answer [code]):\nHave you ever reacted to a colour service? → No [prior_reaction=no]',
        },
        {
          type: 'text',
          text: 'Client inspiration: the client brought no reference photograph. Work from her intake answers alone and do not invent a reference.',
        },
        {
          type: 'text',
          text: [
            'Client feature profile (already established from these same photographs — treat as settled, do not re-derive):',
            '- skinUndertone: NEUTRAL (confidence 0.4–0.65, read from face_front)',
            '- contrastLevel: MEDIUM (confidence 0.4–0.65, read from face_front)',
            '- colorSeason: UNKNOWN (not established — do not lean on it)',
          ].join('\n'),
        },
      ],
      schema: buildConsultDirectionOutputSchema({
        menuServiceNames: [...MENU],
        safetyCodes: [...SAFETY_CODES],
        suppliedShotKeys: [...SHOT_KEYS],
      }),
      maxTokens: CONSULT_ANALYSIS_DIRECTION_MAX_TOKENS,
    })

    const direction = sanitizeConsultDirectionResponse(raw, {
      menuServiceNames: [...MENU],
    })
    expect(direction.styleDirections).toHaveLength(7)
    expect(direction.recommendations.length).toBeGreaterThan(0)
    // The levels are the point of schema v4: two named ends, ordered, each
    // citing hair views only.
    for (const field of ['baseLevel', 'lightestLevel'] as const) {
      const level = direction.core[field]
      expect(level.value).toMatch(/^(LEVEL_(10|[1-9])|UNKNOWN)$/)
      for (const cited of level.evidence) {
        expect(cited).toMatch(/^hair_/)
      }
    }
  })

  it('the inspiration schema returns a payload the sanitizer accepts', async () => {
    const image = fixture('synthetic-i-hair_back')
    const raw = await send({
      system: CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
        },
        {
          type: 'text',
          text: 'This is the client’s inspiration reference. Read its hair colour into the eight fields. Use UNKNOWN wherever this photograph does not show you the answer.',
        },
      ],
      schema: CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
      maxTokens: CONSULT_INSPIRATION_MAX_TOKENS,
    })

    // A synthetic fixture may legitimately be unreadable, and `unreadable` is
    // the sanitizer working, not failing — but it is the ONLY failure this
    // test tolerates, and it still proves the schema compiled and answered.
    try {
      const analysis = sanitizeLocalizedInspirationAnalysis(raw)
      expect(Object.keys(analysis)).toHaveLength(8)
      expect(analysis.baseLevel.value).toMatch(/^(LEVEL_(10|[1-9])|UNKNOWN)$/)
    } catch (error) {
      expect(error).toBeInstanceOf(ConsultInspirationVisionError)
      expect((error as ConsultInspirationVisionError).kind).toBe('unreadable')
    }
  })

  // ── P5g — the adaptive follow-up call ─────────────────────────────────────

  /**
   * The vocabulary of a real hair-COLOUR consult mid-prep: two unanswered
   * safety questions from intake v3, and keys from that pack's own follow-up
   * (lib/consult/intake/followUp.ts — `last_color_service_timing`,
   * `event_timing`, `budget`).
   *
   * 🔴 Every key here is one `resolveConsultFollowUpVocabulary` can actually
   * produce for this family. The first version used `maintenance_tolerance`,
   * which the hair-colour follow-up pack does NOT carry (it is hair-general's)
   * — so this suite was exercising a vocabulary no client can be served, and
   * its output read like a bug in a rule the product does keep. A live test
   * that sends what production cannot send proves nothing about production.
   */
  const FOLLOW_UP_ENTRIES: ConsultFollowUpVocabularyEntry[] = [
    {
      key: 'prior_lightening',
      home: 'INTAKE',
      packLabel: 'When was your hair last lightened?',
      safety: true,
      options: [
        { value: 'never', label: 'Never' },
        { value: 'within-3-months', label: 'Within 3 months' },
        { value: '3-6-months', label: '3–6 months ago' },
        { value: 'over-12-months', label: 'Over 12 months ago' },
        { value: 'not-sure', label: 'Not sure' },
      ],
    },
    {
      key: 'henna_plant_dye_history',
      home: 'INTAKE',
      packLabel:
        'When did you last use henna or another plant-based hair dye?',
      safety: true,
      options: [
        { value: 'never', label: 'Never' },
        { value: 'within-6-months', label: 'Within 6 months' },
        { value: 'over-12-months', label: 'Over 12 months ago' },
        { value: 'not-sure', label: 'Not sure' },
      ],
    },
    {
      key: 'last_color_service_timing',
      home: 'FOLLOW_UP',
      packLabel: 'When was your last color service?',
      safety: false,
      options: [
        { value: 'never', label: 'Never' },
        { value: 'within-4-weeks', label: 'Within 4 weeks' },
        { value: '4-6-months', label: '4–6 months ago' },
        { value: 'over-12-months', label: 'Over 12 months ago' },
        { value: 'not-sure', label: 'Not sure' },
      ],
    },
    {
      key: 'event_timing',
      home: 'FOLLOW_UP',
      packLabel: 'Do you have an event or deadline?',
      safety: false,
      options: [
        { value: 'no-deadline', label: 'No deadline' },
        { value: 'within-2-weeks', label: 'Within 2 weeks' },
        { value: '1-3-months', label: '1–3 months' },
      ],
    },
  ]

  const FOLLOW_UP_VOCABULARY: ConsultFollowUpVocabulary = {
    entries: FOLLOW_UP_ENTRIES,
    byKey: new Map(FOLLOW_UP_ENTRIES.map((entry) => [entry.key, entry])),
  }

  // 🔴 Typed helpers, not casts. A type escape here would let a renamed or
  // re-shaped field compile and then send the model a context block production
  // could never produce — precisely the class of bug this live suite exists to
  // catch, papered over in the test that catches it.
  //
  // ⚠️ This comment does not spell the escape out, and that is deliberate:
  // `check:no-type-escape` is a substring match over the file, so naming the
  // pattern in PROSE fails the build exactly as writing one would.
  function observation<const T extends string>(
    value: T,
    min: number,
    max: number,
  ): ConsultInspirationAnalysisObservationDTO<T> {
    return { value, confidence: { min, max }, evidence: ['inspiration'], region: null }
  }

  function coreObservation<const T extends string>(
    value: T,
    evidence: ConsultAnalysisEvidenceDTO[],
  ) {
    return { value, confidence: { min: 0.45, max: 0.7 }, evidence }
  }

  const BLONDE_INSPIRATION: ConsultInspirationAnalysisAttributesDTO = {
    baseLevel: observation('LEVEL_6', 0.45, 0.7),
    lightestLevel: observation('LEVEL_9', 0.5, 0.75),
    tone: observation('COOL', 0.45, 0.7),
    technique: observation('BABYLIGHTS', 0.4, 0.65),
    placement: observation('MIDS_TO_ENDS', 0.4, 0.65),
    rootBlend: observation('SEAMLESS_MELT', 0.4, 0.65),
    finish: observation('HIGH_SHINE', 0.4, 0.6),
    // Unread on purpose — the prompt is told so, and told not to lean on it.
    dimension: observation('UNKNOWN', 0.05, 0.3),
  }

  const HER_OWN_HAIR: ConsultAnalysisCore = {
    baseLevel: coreObservation('LEVEL_6', ['hair_back', 'hair_crown']),
    lightestLevel: coreObservation('LEVEL_7', ['hair_left']),
    currentTone: coreObservation('GOLDEN', ['hair_back']),
    visibleCondition: coreObservation('NO_VISIBLE_CONCERN', ['hair_right']),
    density: coreObservation('MEDIUM', ['hair_crown']),
    texture: coreObservation('WAVY', ['hair_left']),
  }

  /** The blonde case, exactly as the thread would render it. */
  const FOLLOW_UP_CONTEXT = renderConsultFollowUpContext({
    professionalDisplayName: 'Susie',
    serviceName: 'Signature Balayage',
    inspiration: BLONDE_INSPIRATION,
    core: HER_OWN_HAIR,
    preferences: {
      wants: ['lightestLevel:LEVEL_9', 'tone:COOL'],
      avoids: ['baseLevel:LEVEL_6'],
      unsure: [],
      keep: ['My length'],
    },
    intakeAnswers: { change_scale: 'noticeable', box_dye_history: 'never' },
    followUpAnswers: {},
    vocabulary: FOLLOW_UP_VOCABULARY,
    copy: defaultClientConsultInspirationCopy,
    roundNumber: 1,
    maxRounds: 3,
  })

  /**
   * 🔴 THE REQUIRED-SUCCESS FIXTURE (Part 0 rule 10).
   *
   * This one may not degrade into "the sanitizer refused, which is also the
   * sanitizer working" — that escape is legitimate for an unreadable
   * PHOTOGRAPH and meaningless here, where the input is text this repo wrote.
   * A refusal is the feature not working, and the whole point of rule 10 is a
   * case that says so.
   */
  it('P5g — the follow-up schema returns questions the sanitizer ACCEPTS', async () => {
    const raw = await send({
      system: CONSULT_FOLLOW_UP_SYSTEM_PROMPT,
      content: [{ type: 'text', text: FOLLOW_UP_CONTEXT }],
      schema: buildConsultFollowUpOutputSchema(FOLLOW_UP_VOCABULARY),
      maxTokens: CONSULT_FOLLOW_UP_MAX_TOKENS,
      effort: CONSULT_FOLLOW_UP_EFFORT,
    })

    const questions = sanitizeConsultFollowUpQuestions(raw, FOLLOW_UP_VOCABULARY)
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.length).toBeLessThanOrEqual(CONSULT_FOLLOW_UP_MAX_QUESTIONS)

    // 🔴 SAFETY FIRST is a prompt rule with no grammar behind it, so it is
    // asserted against the live model rather than assumed. Both unanswered
    // safety keys are in the vocabulary; the first question must be one of
    // them.
    expect(['prior_lightening', 'henna_plant_dye_history']).toContain(
      questions[0]!.key,
    )

    for (const question of questions) {
      // Every option maps to a real enum — proven by the sanitizer above, and
      // restated here because it is the claim the whole feature rests on.
      const entry = FOLLOW_UP_VOCABULARY.byKey.get(question.key)!
      const allowed = new Set(entry.options.map((option) => option.value))
      for (const option of question.options) {
        expect(allowed.has(option.value)).toBe(true)
      }
      expect(question.evidence.trim()).not.toBe('')
    }

    // Report every generated question verbatim, so a person can grade whether
    // it sounds like listening. That judgement is Tori's and no assertion can
    // make it.
    console.log(
      '\nP5g follow-up — the blonde case:\n' +
        questions
          .map(
            (question, index) =>
              `  ${index + 1}. [${question.key} → ${question.home}] ${question.text}\n` +
              `     evidence: ${question.evidence}\n` +
              `     options: ${question.options
                .map((option) => `${option.label} (${option.value})`)
                .join(' · ')}`,
          )
          .join('\n'),
    )
  })

  /**
   * A question that would be the same for everybody is the question P5g exists
   * to delete, so "it referenced something specific" is asserted rather than
   * hoped for. Deliberately a SEPARATE call: one response satisfying both this
   * and the safety-order rule above would prove less than two do.
   */
  it('P5g — a follow-up references something it was actually told', async () => {
    // 🔴 Round 2's vocabulary is round 1's MINUS what she answered, and its
    // context carries those answers. The first version of this test dropped
    // only the safety entries and passed `followUpAnswers: {}` — so it offered
    // a key round 1 had just asked and told the model nothing about it, and the
    // model duly asked it twice. That was the FIXTURE contradicting the
    // product's own rule, not the product breaking it
    // (`consult-follow-up.test.ts` proves the rule on a real consult), but a
    // live test whose output reads like a bug is worse than no live test.
    const answered = {
      prior_lightening: ['over-12-months'],
      last_color_service_timing: ['4-6-months'],
    }
    const remaining = FOLLOW_UP_ENTRIES.filter(
      (entry) => !entry.safety && !(entry.key in answered),
    )
    const withSafetyAnswered: ConsultFollowUpVocabulary = {
      entries: remaining,
      byKey: new Map(remaining.map((entry) => [entry.key, entry])),
    }
    const context = renderConsultFollowUpContext({
      professionalDisplayName: 'Susie',
      serviceName: 'Signature Balayage',
      inspiration: null,
      core: HER_OWN_HAIR,
      preferences: {
        wants: ['lightestLevel:LEVEL_9', 'tone:COOL'],
        avoids: [],
        unsure: [],
        keep: ['My length'],
      },
      intakeAnswers: {
        change_scale: 'noticeable',
        prior_lightening: 'over-12-months',
        henna_plant_dye_history: 'never',
      },
      followUpAnswers: { last_color_service_timing: ['4-6-months'] },
      vocabulary: withSafetyAnswered,
      copy: defaultClientConsultInspirationCopy,
      roundNumber: 2,
      maxRounds: 3,
    })

    const raw = await send({
      system: CONSULT_FOLLOW_UP_SYSTEM_PROMPT,
      content: [{ type: 'text', text: context }],
      schema: buildConsultFollowUpOutputSchema(withSafetyAnswered),
      maxTokens: CONSULT_FOLLOW_UP_MAX_TOKENS,
      effort: CONSULT_FOLLOW_UP_EFFORT,
    })
    const questions = sanitizeConsultFollowUpQuestions(raw, withSafetyAnswered)
    expect(questions.length).toBeGreaterThan(0)

    // 🔴 It must not have described the person — the same rule the database
    // CHECK enforces, asserted against the live model because the prompt is
    // the only thing steering it.
    const prose = questions.map((q) => `${q.text} ${q.evidence}`).join(' ')
    expect(prose).not.toMatch(
      /\b(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\b/i,
    )

    // 🔴 It cannot re-ask what round 1 got: the key is not in the vocabulary,
    // so this is the grammar refusing rather than the prompt being trusted.
    for (const question of questions) {
      expect(Object.keys(answered)).not.toContain(question.key)
    }

    // 🔴 US spelling (Tori, 2026-09-06). The model answered "colour" because
    // the prompt asked in British English; both now say "color".
    const clientFacing = questions
      .map((q) => `${q.text} ${q.options.map((o) => o.label).join(' ')}`)
      .join(' ')
    expect(clientFacing).not.toMatch(/\bcolour\b/i)
    expect(clientFacing).not.toMatch(/\bgrey\b/i)

    // 🔴 And where it names her starting point, it uses THE phrase — one
    // description per plan version, not a fresh one each round.
    const phrase = consultStartingPointPhrase(
      HER_OWN_HAIR,
      defaultClientConsultInspirationCopy,
    )
    expect(phrase).toBe('your light brown, golden base')
    for (const question of questions) {
      if (/starting from|you'?re at|base\b/i.test(question.text)) {
        expect(question.text.toLowerCase()).toContain(phrase!.toLowerCase())
      }
    }

    console.log(
      '\nP5g follow-up — round 2, safety already answered:\n' +
        questions
          .map((q, i) => `  ${i + 1}. [${q.key}] ${q.text}\n     evidence: ${q.evidence}`)
          .join('\n'),
    )
  })
  it('the early selfie alone is an admissible analysis input, through the real engine (prod, 2026-09-11)', async () => {
    // What production does on "Build my plan" when the client has taken only the
    // any-light early selfie: the same engine, the same pack keys, one image,
    // look planning on. Until 2026-09-11 this refused in ~1s before the call.
    // The required-success contract: it must come back and validate as the
    // server would — with `early_photo` the only supplied evidence.
    const menu: ConsultProMenuOffering[] = [
      ['Full balayage', 'Hand-painted lightening for a blended, dimensional result.'],
      ['Toner gloss', 'Refreshes tone and shine between colour services.'],
    ].map(([name, description], index) => ({
      id: `offering-${index}`, serviceId: `service-${index}`,
      offersInSalon: true, offersMobile: false,
      salonPriceStartingAt: new Prisma.Decimal(200), salonDurationMinutes: 120,
      mobilePriceStartingAt: null, mobileDurationMinutes: null,
      service: { name: name!, description: description!, categoryId: `category-${index}`, defaultDurationMinutes: 120 },
    }))
    const menuServiceNames = menu.map(item => item.service.name)
    const result = await runConsultAnalysis({
      service: { family: 'HAIR', categoryName: 'Color', serviceName: 'Full balayage', menuServiceNames, lookPlanning: true, menuOfferings: menu },
      intake: { desired_color: 'lighter' }, intakeItems: [{ questionKey: 'desired_color', question: 'Your dream color?', answerCode: 'lighter', answer: 'Lighter, warmer' }],
      capturePack: { id: 'hair-color-daylight', shotKeys: SHOT_KEYS },
      captures: [{ shotKey: 'early_photo', image: fixture('synthetic-i-face_front'), qualityWarningCode: null }],
      inspiration: { source: 'NONE', analysis: null, answers: [], wants: [], avoids: [], unsure: [], keep: [] },
      safetyCodes: SAFETY_CODES,
    })
    // What the model cited, before the server's own check — so a refusal here
    // names the field, not just the code.
    console.log('early-only citations', JSON.stringify({
      core: Object.fromEntries(Object.entries(result.analysis.core).map(([key, value]) => [key, { value: value.value, evidence: value.evidence, confidence: value.confidence }])),
      profile: Object.fromEntries(Object.entries(result.analysis.profile).map(([key, value]) => [key, { value: value.value, evidence: value.evidence }])),
      styles: result.analysis.styleDirections.map(direction => ({ domain: direction.domain, evidence: direction.evidence, confidence: direction.confidence })),
      lookPlan: result.analysis.lookPlan ? { tier: result.analysis.lookPlan.tier, blocker: result.analysis.lookPlan.blocker } : null,
    }))
    // The run loader's own gate, with the same arguments it passes.
    const validated = validateConsultAnalysisProviderResult(result, { menuServiceNames, lookPlanMenu: menu, suppliedShotKeys: ['early_photo'] })
    expect(validated).toEqual(result)
    // Hair levels cannot be read from a selfie: the prompt says UNKNOWN, and
    // the server would refuse a hair-view citation that was never supplied.
    expect(result.analysis.core.baseLevel.evidence).toEqual([])
    expect(result.analysis.lookPlan ?? null).not.toBeNull()
  })

})
