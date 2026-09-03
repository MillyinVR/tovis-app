// lib/consult/intakePack.ts
//
// The hair-colour pack's historical entry point. The pack itself now lives in
// lib/consult/intake/packs/hairColor.ts and the validation engine in
// lib/consult/intake/registry.ts, where every pack shares it. These exports
// keep their exact behaviour for the callers and tests that still name the
// colour pack directly; new code should resolve the pack from the session's
// service profile (lib/consult/serviceProfile.ts) instead.

import type { ConsultIntakeAnswerMapDTO } from '@/lib/dto/consult'

import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
import {
  evaluateConsultIntakeProgress,
  normalizeConsultIntakePayloadForPack,
  validateConsultIntakeAnswers,
} from './intake/registry'
import type {
  ConsultIntakePayload,
  ConsultIntakeProgress,
  ConsultIntakeValidationResult,
} from './intake/types'

export {
  HAIR_COLOR_INTAKE_PACK,
  HAIR_COLOR_INTAKE_PACK_ID,
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_QUESTION_KEYS,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
  validateHairColorC5EvaluationIntakeAnswers,
  type HairColorIntakeQuestionKey,
} from './intake/packs/hairColor'
export type {
  ConsultIntakeValidationErrorCode,
  ConsultIntakeValidationResult,
} from './intake/types'

export type HairColorIntakeProgress = ConsultIntakeProgress

export function evaluateHairColorIntakeProgress(
  answers: Readonly<ConsultIntakeAnswerMapDTO>,
): HairColorIntakeProgress {
  return evaluateConsultIntakeProgress(HAIR_COLOR_INTAKE_PACK, answers)
}

export function validateHairColorIntakeAnswers(
  raw: unknown,
  complete: boolean,
): ConsultIntakeValidationResult {
  return validateConsultIntakeAnswers(HAIR_COLOR_INTAKE_PACK, raw, complete)
}

export function normalizeHairColorIntakePayload(
  raw: unknown,
): ConsultIntakePayload | null {
  return normalizeConsultIntakePayloadForPack(HAIR_COLOR_INTAKE_PACK, raw)
}
