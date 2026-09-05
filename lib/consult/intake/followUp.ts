// lib/consult/intake/followUp.ts
//
// "A few things your pro will want to know" — the questions the P6 diet took
// OUT of the pre-analysis intake because nothing before the analysis needs
// them, and which the pro genuinely does want before the appointment.
//
// They are not deleted: they are re-homed onto the Look Brief, which is the
// step where the client and the pro confirm the same plan
// (docs/consult/tovis-ai-consult-handoff.md, Stage 6). P10 renders and
// collects them; this module is where they are DEFINED and served from, so a
// question the diet removed is never a question the product lost.
//
// It also fixes handoff bug B6. "Have you had this kind of service before?"
// used to be the FIRST question a client saw, before any service had been
// named — on a look-anchored consult, before the flow even knew which service
// the look maps to, so there was nothing for "this" to refer to. Here the
// service is known, so the question can finally say what it means:
// "Have you had Balayage before?".
//
// 🔴 These questions never re-enter the intake pack. The safety policy
// (lib/consult/safetyFlags.ts) and the database mirror in
// `consult_analysis_payload_guard` decide what an analysis may claim from the
// keys the INTAKE pack asks; an answer collected here arrives after the
// analysis has already run and must not be read as if it had been available to
// it.

import type { ConsultIntakeQuestionDTO } from '@/lib/dto/consult'

import {
  GENERAL_SERVICE_INTAKE_PACK_ID,
  GENERAL_SERVICE_INTAKE_PACK_V1,
} from './packs/generalService'
import { HAIR_COLOR_INTAKE_PACK_ID, HAIR_COLOR_INTAKE_PACK_V2 } from './packs/hairColor'
import {
  HAIR_GENERAL_INTAKE_PACK_ID,
  HAIR_GENERAL_INTAKE_PACK_V1,
} from './packs/hairGeneral'
import { SERVICE_EXPERIENCE_OPTIONS } from './sharedOptions'
import { intakeQuestion, type ConsultIntakePackDefinition } from './types'

/** The heading P10 renders this step under. */
export const CONSULT_INTAKE_FOLLOW_UP_TITLE =
  'A few things your pro will want to know'

export const CONSULT_INTAKE_FOLLOW_UP_SCHEMA_VERSION = 1

/**
 * The question key B6 is about. It lives here, not in any intake pack — its
 * label is only answerable once a service has a name.
 */
export const CONSULT_FOLLOW_UP_SERVICE_EXPERIENCE_KEY = 'service_experience'

export type ConsultIntakeFollowUpPackDefinition = {
  readonly id: string
  /** The intake pack whose diet produced this follow-up. */
  readonly intakePackId: string
  readonly version: number
  readonly schemaVersion: number
  readonly title: string
  readonly questions: readonly ConsultIntakeQuestionDTO[]
}

/**
 * The service-experience question, phrased with the service the consult is
 * actually about. With no name resolvable it falls back to the v1 wording
 * rather than to a blank — an unnamed service is a real state (a Look whose
 * linked service was deleted), and a question with a hole in it is worse than
 * a vague one.
 */
export function consultFollowUpServiceExperienceQuestion(
  serviceName: string | null,
): ConsultIntakeQuestionDTO {
  const name = serviceName?.trim()
  return intakeQuestion(
    CONSULT_FOLLOW_UP_SERVICE_EXPERIENCE_KEY,
    name ? `Have you had ${name} before?` : 'Have you had this kind of service before?',
    'REQUIRED',
    SERVICE_EXPERIENCE_OPTIONS,
  )
}

/**
 * Questions the diet moved out, taken from the pack version that last asked
 * them so key, options and wording are the ones already reviewed — the diet
 * re-homes questions, it does not rewrite them.
 */
function movedQuestions(
  source: ConsultIntakePackDefinition,
  keys: readonly string[],
): ConsultIntakeQuestionDTO[] {
  return keys.map((key) => {
    const question = source.questions.find((entry) => entry.key === key)
    if (!question) {
      throw new Error(
        `Consult follow-up pack references unknown ${source.id} question "${key}".`,
      )
    }
    return question
  })
}

const FOLLOW_UP_BY_INTAKE_PACK_ID: ReadonlyMap<
  string,
  ConsultIntakeFollowUpPackDefinition
> = new Map([
  [
    HAIR_COLOR_INTAKE_PACK_ID,
    {
      id: 'hair-color-follow-up',
      intakePackId: HAIR_COLOR_INTAKE_PACK_ID,
      version: 1,
      schemaVersion: CONSULT_INTAKE_FOLLOW_UP_SCHEMA_VERSION,
      title: CONSULT_INTAKE_FOLLOW_UP_TITLE,
      // The colour pack never asked service_experience at all — B6 was
      // reported against the hair-general and general-service packs. It is
      // asked here for every pack, because a pro wants the answer for a colour
      // service just as much, and here it can name the service.
      questions: movedQuestions(HAIR_COLOR_INTAKE_PACK_V2, [
        'last_color_service_timing',
        'event_timing',
        'budget',
      ]),
    },
  ],
  [
    HAIR_GENERAL_INTAKE_PACK_ID,
    {
      id: 'hair-general-follow-up',
      intakePackId: HAIR_GENERAL_INTAKE_PACK_ID,
      version: 1,
      schemaVersion: CONSULT_INTAKE_FOLLOW_UP_SCHEMA_VERSION,
      title: CONSULT_INTAKE_FOLLOW_UP_TITLE,
      questions: movedQuestions(HAIR_GENERAL_INTAKE_PACK_V1, [
        'last_service_timing',
        'maintenance_tolerance',
        'event_timing',
        'budget',
      ]),
    },
  ],
  [
    GENERAL_SERVICE_INTAKE_PACK_ID,
    {
      id: 'general-service-follow-up',
      intakePackId: GENERAL_SERVICE_INTAKE_PACK_ID,
      version: 1,
      schemaVersion: CONSULT_INTAKE_FOLLOW_UP_SCHEMA_VERSION,
      title: CONSULT_INTAKE_FOLLOW_UP_TITLE,
      questions: movedQuestions(GENERAL_SERVICE_INTAKE_PACK_V1, [
        'last_service_timing',
        'maintenance_tolerance',
        'event_timing',
        'budget',
      ]),
    },
  ],
])

/**
 * The follow-up step for one consult: the service-experience question first,
 * named with the service, then the questions the diet moved out of that
 * consult's intake pack.
 *
 * Returns `null` for a pack id that has no follow-up rather than an empty
 * step — a caller must be able to tell "nothing to ask" from "this pack is not
 * one we know".
 */
export function resolveConsultIntakeFollowUpPack(args: {
  intakePackId: string
  /** The client-facing service name (lib/consult/serviceIdentity.ts). */
  serviceName: string | null
}): ConsultIntakeFollowUpPackDefinition | null {
  const followUp = FOLLOW_UP_BY_INTAKE_PACK_ID.get(args.intakePackId)
  if (!followUp) return null
  return {
    ...followUp,
    questions: [
      consultFollowUpServiceExperienceQuestion(args.serviceName),
      ...followUp.questions,
    ],
  }
}
