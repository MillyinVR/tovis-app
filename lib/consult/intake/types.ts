// lib/consult/intake/types.ts
//
// The shape of an intake question pack as the SERVER owns it: the wire DTO
// (id, category, versions, questions) plus the one rule the wire cannot carry —
// which question is the pack's conditional goal refinement and when it is
// required. Every pack in lib/consult/intake/packs/ is one of these; the
// generic engine in lib/consult/intake/registry.ts reads nothing else.

import type {
  ConsultIntakeAnswerMapDTO,
  ConsultIntakeQuestionDTO,
  ConsultIntakeQuestionPackDTO,
} from '@/lib/dto/consult'

/**
 * A pack's CONDITIONAL question. Every pack asks "what would you most like to
 * change?" only when the headline answers leave the goal ambiguous (a subtle
 * change, the same colour you already have, an unsure dream). The rule that
 * decides "ambiguous" is the pack's own; the engine only knows there is one
 * question, one unresolved value, and one predicate.
 */
export type ConsultIntakeGoalDirectionRule = {
  questionKey: string
  /** The option that means "still not sure" — a complete intake cannot carry it. */
  unresolvedValue: string
  requiredWhen: (answers: Readonly<ConsultIntakeAnswerMapDTO>) => boolean
}

export type ConsultIntakePackDefinition = Readonly<ConsultIntakeQuestionPackDTO> & {
  readonly goalDirection: ConsultIntakeGoalDirectionRule | null
}

export type ConsultIntakeValidationErrorCode =
  | 'INVALID_ANSWERS'
  | 'REQUIRED_ANSWERS_MISSING'
  | 'GOAL_DIRECTION_REQUIRED'
  | 'GOAL_DIRECTION_UNRESOLVED'

export type ConsultIntakeValidationResult =
  | { ok: true; answers: ConsultIntakeAnswerMapDTO }
  | {
      ok: false
      code: ConsultIntakeValidationErrorCode
      message: string
    }

export type ConsultIntakeProgress = {
  canComplete: boolean
  nextQuestionKey: string | null
  blocker:
    | 'REQUIRED_ANSWERS_MISSING'
    | 'GOAL_DIRECTION_REQUIRED'
    | 'GOAL_DIRECTION_UNRESOLVED'
    | null
}

/** A stored INTAKE revision payload, normalized against its own pack. */
export type ConsultIntakePayload = {
  packId: string
  packVersion: number
  schemaVersion: number
  complete: boolean
  answers: ConsultIntakeAnswerMapDTO
}

export type ConsultIntakeOptionValues = ReadonlyArray<readonly [string, string]>

export function intakeOptions(
  values: ConsultIntakeOptionValues,
): ConsultIntakeQuestionDTO['options'] {
  return values.map(([value, label]) => ({ value, label }))
}

export function intakeQuestion(
  key: string,
  label: string,
  requirement: ConsultIntakeQuestionDTO['requirement'],
  values: ConsultIntakeOptionValues,
  helpText: string | null = null,
): ConsultIntakeQuestionDTO {
  return {
    key,
    label,
    helpText,
    kind: 'SINGLE_SELECT',
    requirement,
    options: intakeOptions(values),
  }
}

/**
 * P6 (the intake diet): a NEW VERSION of an existing pack that keeps only the
 * questions the analysis cannot answer for itself, and may re-word the ones it
 * keeps.
 *
 * Derived from the previous version rather than re-typed, for two reasons. A
 * kept question's KEY and OPTION VALUES are what the safety policy
 * (lib/consult/safetyFlags.ts, lib/consult/safetyRouting.ts) and the database
 * guards read, so they must be byte-identical to the version they came from —
 * deriving makes that structural instead of a thing to check. And a `keep` key
 * the base pack does not have is a module-load error, not a question that
 * quietly fails to appear.
 */
export function dietedIntakePack(args: {
  base: ConsultIntakePackDefinition
  version: number
  /** Kept question keys, in the order the client is asked them. */
  keep: readonly string[]
  /** Re-wording for a kept question — everything else is inherited. */
  reword?: Readonly<
    Record<string, { label?: string; helpText?: string | null }>
  >
  goalDirection: ConsultIntakeGoalDirectionRule | null
}): ConsultIntakePackDefinition {
  const byKey = new Map(args.base.questions.map((entry) => [entry.key, entry]))
  const questions = args.keep.map((key) => {
    const question = byKey.get(key)
    if (!question) {
      throw new Error(
        `Intake pack ${args.base.id} v${args.version} keeps unknown question "${key}".`,
      )
    }
    const reword = args.reword?.[key]
    if (!reword) return question
    return {
      ...question,
      label: reword.label ?? question.label,
      helpText: reword.helpText === undefined ? question.helpText : reword.helpText,
    }
  })
  if (args.goalDirection && !questions.some((entry) => entry.key === args.goalDirection?.questionKey)) {
    throw new Error(
      `Intake pack ${args.base.id} v${args.version} drops its goal-direction question.`,
    )
  }
  return {
    id: args.base.id,
    categorySlug: args.base.categorySlug,
    version: args.version,
    schemaVersion: args.base.schemaVersion,
    goalDirection: args.goalDirection,
    questions,
  }
}
