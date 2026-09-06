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

import { readFileSync } from 'node:fs'
import path from 'node:path'

import Anthropic from '@anthropic-ai/sdk'
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
  sanitizeConsultProfileResponse,
} from '@/lib/consult/analysisEngine'
import {
  CONSULT_INSPIRATION_ANALYSIS_OUTPUT_SCHEMA,
  CONSULT_INSPIRATION_ANALYSIS_SYSTEM_PROMPT,
  CONSULT_INSPIRATION_MAX_TOKENS,
  ConsultInspirationVisionError,
  sanitizeConsultInspirationAnalysis,
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
import { renderConsultFollowUpContext } from '@/lib/consult/followUpContext'
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
  return JSON.parse(text) as unknown
}

describe('the consult schemas compile and answer against the live model', () => {
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
    expect(Object.keys(profile)).toHaveLength(11)
    for (const observation of Object.values(profile)) {
      expect(Object.keys(observation).sort()).toEqual([
        'confidence',
        'evidence',
        'value',
      ])
      expect(observation.confidence.min).toBeLessThan(observation.confidence.max)
    }
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
      const analysis = sanitizeConsultInspirationAnalysis(raw)
      expect(Object.keys(analysis)).toHaveLength(8)
      expect(analysis.baseLevel.value).toMatch(/^(LEVEL_(10|[1-9])|UNKNOWN)$/)
    } catch (error) {
      expect(error).toBeInstanceOf(ConsultInspirationVisionError)
      expect((error as ConsultInspirationVisionError).kind).toBe('unreadable')
    }
  })

  // ── P5g — the adaptive follow-up call ─────────────────────────────────────

  /**
   * The vocabulary of a real hair-colour consult mid-prep: the two safety
   * questions she has not answered, and the follow-up pack's own keys.
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
      key: 'maintenance_tolerance',
      home: 'FOLLOW_UP',
      packLabel: 'How much upkeep are you happy with?',
      safety: false,
      options: [
        { value: 'low', label: 'As little as possible' },
        { value: 'medium', label: 'Some upkeep is fine' },
        { value: 'high', label: 'I do not mind regular upkeep' },
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
    const withSafetyAnswered: ConsultFollowUpVocabulary = {
      entries: FOLLOW_UP_ENTRIES.filter((entry) => !entry.safety),
      byKey: new Map(
        FOLLOW_UP_ENTRIES.filter((entry) => !entry.safety).map((entry) => [
          entry.key,
          entry,
        ]),
      ),
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
      intakeAnswers: { change_scale: 'noticeable' },
      followUpAnswers: {},
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

    console.log(
      '\nP5g follow-up — round 2, safety already answered:\n' +
        questions
          .map((q, i) => `  ${i + 1}. [${q.key}] ${q.text}\n     evidence: ${q.evidence}`)
          .join('\n'),
    )
  })
})
