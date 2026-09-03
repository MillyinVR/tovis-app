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
