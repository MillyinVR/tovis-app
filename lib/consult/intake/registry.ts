// lib/consult/intake/registry.ts
//
// Every intake pack the consult can serve, and the ONE engine that validates,
// sequences and normalizes answers against any of them. A pack is data; the
// rules that used to be written into the hair-colour module by hand (required
// walk, the conditional goal question, exact option matching, exact payload
// shape) live here once and apply to every pack the same way.
//
// Resolution is by SERVICE PROFILE (lib/consult/serviceProfile.ts): the colour
// pack for the hair-colour category, the hair pack for every other HAIR-family
// category, the general pack for everything else — including a family nobody
// has modelled yet. A pack id stored on a ConsultRevision is looked up here on
// read, so a session keeps the pack it started with even after resolution
// rules change.

import type { ConsultServiceFamily } from '@prisma/client'

import type {
  ConsultBriefClientIntakeItemDTO,
  ConsultIntakeAnswerMapDTO,
  ConsultIntakeQuestionPackDTO,
} from '@/lib/dto/consult'

import { GENERAL_SERVICE_INTAKE_PACK } from './packs/generalService'
import { HAIR_COLOR_INTAKE_PACK } from './packs/hairColor'
import { HAIR_GENERAL_INTAKE_PACK } from './packs/hairGeneral'
import type {
  ConsultIntakePackDefinition,
  ConsultIntakePayload,
  ConsultIntakeProgress,
  ConsultIntakeValidationResult,
} from './types'

export const CONSULT_INTAKE_PACKS: readonly ConsultIntakePackDefinition[] = [
  HAIR_COLOR_INTAKE_PACK,
  HAIR_GENERAL_INTAKE_PACK,
  GENERAL_SERVICE_INTAKE_PACK,
]

const PACKS_BY_ID = new Map(CONSULT_INTAKE_PACKS.map((pack) => [pack.id, pack]))

/**
 * Category slugs that carry their OWN pack, ahead of the family rule. Data,
 * not a gate: the colour pack asks colour questions, so the colour category
 * gets it whatever family it sits in.
 */
const PACKS_BY_CATEGORY_SLUG: ReadonlyMap<string, ConsultIntakePackDefinition> =
  new Map([[HAIR_COLOR_INTAKE_PACK.categorySlug, HAIR_COLOR_INTAKE_PACK]])

export function findConsultIntakePack(
  packId: string,
): ConsultIntakePackDefinition | null {
  return PACKS_BY_ID.get(packId) ?? null
}

export function resolveConsultIntakePack(args: {
  categorySlug: string
  family: ConsultServiceFamily
}): ConsultIntakePackDefinition {
  const bySlug = PACKS_BY_CATEGORY_SLUG.get(args.categorySlug)
  if (bySlug) return bySlug
  return args.family === 'HAIR' ? HAIR_GENERAL_INTAKE_PACK : GENERAL_SERVICE_INTAKE_PACK
}

/** The wire shape of a pack: everything the client renders, no rules. */
export function toConsultIntakeQuestionPackDTO(
  pack: ConsultIntakePackDefinition,
): ConsultIntakeQuestionPackDTO {
  return {
    id: pack.id,
    categorySlug: pack.categorySlug,
    version: pack.version,
    schemaVersion: pack.schemaVersion,
    questions: pack.questions,
  }
}

function questionsByKey(pack: ConsultIntakePackDefinition) {
  return new Map(pack.questions.map((question) => [question.key, question]))
}

/** Server-owned sequence/progress contract for one-question-at-a-time clients. */
export function evaluateConsultIntakeProgress(
  pack: ConsultIntakePackDefinition,
  answers: Readonly<ConsultIntakeAnswerMapDTO>,
): ConsultIntakeProgress {
  const rule = pack.goalDirection
  for (const definition of pack.questions) {
    if (definition.requirement === 'REQUIRED' && !answers[definition.key]) {
      return {
        canComplete: false,
        nextQuestionKey: definition.key,
        blocker: 'REQUIRED_ANSWERS_MISSING',
      }
    }
    if (rule && definition.key === rule.questionKey) {
      const answer = answers[rule.questionKey]
      if (answer === rule.unresolvedValue) {
        return {
          canComplete: false,
          nextQuestionKey: rule.questionKey,
          blocker: 'GOAL_DIRECTION_UNRESOLVED',
        }
      }
      if (rule.requiredWhen(answers) && !answer) {
        return {
          canComplete: false,
          nextQuestionKey: rule.questionKey,
          blocker: 'GOAL_DIRECTION_REQUIRED',
        }
      }
    }
  }
  return { canComplete: true, nextQuestionKey: null, blocker: null }
}

/** Strict write validation: unknown keys and invalid option values fail. */
export function validateConsultIntakeAnswers(
  pack: ConsultIntakePackDefinition,
  raw: unknown,
  complete: boolean,
): ConsultIntakeValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
  }

  const byKey = questionsByKey(pack)
  const record: Record<string, unknown> = { ...raw }
  const answers: ConsultIntakeAnswerMapDTO = {}
  for (const [key, value] of Object.entries(record)) {
    const definition = byKey.get(key)
    if (!definition || typeof value !== 'string') {
      return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
    }
    const trimmed = value.trim()
    if (!definition.options.some((option) => option.value === trimmed)) {
      return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
    }
    answers[key] = trimmed
  }

  if (Object.keys(answers).length === 0) {
    return { ok: false, code: 'INVALID_ANSWERS', message: 'Invalid answers.' }
  }

  if (complete) {
    const progress = evaluateConsultIntakeProgress(pack, answers)
    if (!progress.canComplete && progress.blocker) {
      return {
        ok: false,
        code: progress.blocker,
        message:
          progress.blocker === 'GOAL_DIRECTION_UNRESOLVED'
            ? 'A goal direction is still unresolved.'
            : 'Required answers are missing.',
      }
    }
  }

  return { ok: true, answers }
}

const PAYLOAD_KEYS = new Set([
  'packId',
  'packVersion',
  'schemaVersion',
  'complete',
  'answers',
])

/**
 * Read normalization for a stored INTAKE payload. The pack is the one the
 * payload NAMES; its versions must be that pack's current versions, its shape
 * exact, its answers valid. Anything else reads as "no intake" (`null`) —
 * stale or malformed rows are skipped, never partially trusted.
 */
export function normalizeConsultIntakePayload(
  raw: unknown,
): ConsultIntakePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record: Record<string, unknown> = { ...raw }
  if (Object.keys(record).some((key) => !PAYLOAD_KEYS.has(key))) return null
  if (typeof record.packId !== 'string') return null
  const pack = findConsultIntakePack(record.packId)
  if (
    !pack ||
    record.packVersion !== pack.version ||
    record.schemaVersion !== pack.schemaVersion ||
    typeof record.complete !== 'boolean'
  ) {
    return null
  }
  const validated = validateConsultIntakeAnswers(
    pack,
    record.answers,
    record.complete,
  )
  if (!validated.ok) return null
  return {
    packId: pack.id,
    packVersion: pack.version,
    schemaVersion: pack.schemaVersion,
    complete: record.complete,
    answers: validated.answers,
  }
}

/**
 * A normalized payload whose pack must ALSO be the one this session serves —
 * what every reader that is about to act on an intake (analysis, brief) needs,
 * as opposed to a reader that merely lists revisions.
 */
export function normalizeConsultIntakePayloadForPack(
  pack: ConsultIntakePackDefinition,
  raw: unknown,
): ConsultIntakePayload | null {
  const payload = normalizeConsultIntakePayload(raw)
  return payload && payload.packId === pack.id ? payload : null
}

/**
 * Stored answer codes → the question and option labels the client actually
 * saw, in pack order. Unanswered questions and codes the pack does not know are
 * skipped, so an old revision read against a newer pack loses items rather
 * than inventing labels.
 */
export function consultIntakeItems(
  pack: ConsultIntakePackDefinition,
  answers: Readonly<Record<string, string>>,
): ConsultBriefClientIntakeItemDTO[] {
  const items: ConsultBriefClientIntakeItemDTO[] = []
  for (const question of pack.questions) {
    const answerCode = answers[question.key]
    if (!answerCode) continue
    const option = question.options.find((candidate) => candidate.value === answerCode)
    if (!option) continue
    items.push({
      questionKey: question.key,
      question: question.label,
      answerCode,
      answer: option.label,
    })
  }
  return items
}
