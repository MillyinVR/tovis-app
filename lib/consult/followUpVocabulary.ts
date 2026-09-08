import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
// lib/consult/followUpVocabulary.ts
//
// P5g — WHICH questions an adaptive follow-up is allowed to ask, and where each
// one's answer is stored.
//
// The model does not invent questions. It picks from a vocabulary this file
// builds for one consult, out of packs that already exist, and it re-words the
// chosen question and its options in the client's own language. That is the
// whole trick: the wording is adaptive and the CONTRACT is not, so an answer
// lands in a column the safety policy and the pro's brief already read.
//
// ## One home per vocabulary
//
// 🔴 A follow-up answer is never stored twice, and never stored somewhere its
// readers cannot see it.
//
//   INTAKE     — a key the consult's live intake pack asks. Written to the
//                INTAKE revision through the ordinary intake path, because
//                that is what `lib/consult/safetyFlags.ts` and the database
//                mirror in `consult_analysis_payload_guard` read. A henna
//                answer collected here and stored anywhere else would be a
//                henna answer the analysis cannot see.
//   FOLLOW_UP  — a key from the post-booking follow-up pack
//                (lib/consult/intake/followUp.ts). P6's diet moved these out of
//                the intake and P10 was to render them; until P5g they had no
//                storage at all. Their home is `ConsultFollowUpRound.answers`.
//
// The INSPIRATION pack is deliberately not a home here. Its questions are
// CARDS over a photograph — a crop, a plain word, a tap — and turning one into
// a sentence would ask her to remember a picture instead of look at one.

import 'server-only'

import { CONSULT_CALIBRATION_QUESTIONS } from './profileCalibration'

import type { ConsultIntakeQuestionDTO } from '@/lib/dto/consult'

import {
  resolveConsultIntakeFollowUpPack,
  type ConsultIntakeFollowUpPackDefinition,
} from './intake/followUp'
import type { ConsultIntakePackDefinition } from './intake/types'

/** Where an answer to one follow-up question is written. */
export type ConsultFollowUpHome = 'INTAKE' | 'FOLLOW_UP'

export type ConsultFollowUpVocabularyEntry = {
  key: string
  home: ConsultFollowUpHome
  /** The question as its pack words it — the model's re-wording must mean this. */
  packLabel: string
  /** Every option value the key accepts, and the pack's own label for each. */
  options: readonly { value: string; label: string }[]
  /**
   * True when this key is one the safety policy routes on. These are the
   * questions the FALLBACK asks when the model call fails, and the ones the
   * prompt is told it must ask before anything else.
   */
  safety: boolean
}

/**
 * The safety keys, across every pack.
 *
 * Named here rather than derived, because "is this a safety question?" is a
 * policy fact and `lib/consult/safetyFlags.ts` is where it is decided — these
 * are exactly the keys that file branches on. A key added to a pack without
 * being added to the policy is not a safety question just because it sounds
 * like one.
 *
 * ⚠️ `known_allergies` and `skin_sensitivity` are here and they are REAL, but
 * the hair-colour pack does not ask either (which is why
 * `ALLERGY_HISTORY_UNKNOWN` is permanently required on a colour consult). A
 * colour consult therefore has no allergy question to fall back to. Closing
 * that needs a hair-colour v4 pack plus a safety-policy change — deferred to
 * P5g-2 by decision (Tori, 2026-09-06), not overlooked.
 */
export const CONSULT_FOLLOW_UP_SAFETY_KEYS: ReadonlySet<string> = new Set([
  'prior_reaction',
  'box_dye_history',
  'prior_lightening',
  'henna_plant_dye_history',
  'other_chemical_history',
  'chemical_history',
  'recent_treatment_timing',
  'known_allergies',
  'skin_sensitivity',
])

function entry(
  question: ConsultIntakeQuestionDTO,
  home: ConsultFollowUpHome,
): ConsultFollowUpVocabularyEntry {
  return {
    key: question.key,
    home,
    packLabel: question.label,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label,
    })),
    safety: CONSULT_FOLLOW_UP_SAFETY_KEYS.has(question.key),
  }
}

export type ConsultFollowUpVocabulary = {
  /** Everything askable, in the order the packs ask it. */
  entries: readonly ConsultFollowUpVocabularyEntry[]
  byKey: ReadonlyMap<string, ConsultFollowUpVocabularyEntry>
}

/**
 * What this consult may still be asked.
 *
 * A question already answered is not in the vocabulary at all — the model
 * cannot ask it, and the fallback cannot re-ask it. That is the "when
 * unanswered" half of the safety rule made structural rather than remembered.
 *
 * 🔴 The follow-up pack is only offered once the consult HAS a service name to
 * put in `service_experience`, which `resolveConsultIntakeFollowUpPack` handles
 * by falling back to the vague wording rather than leaving a hole.
 */
export function resolveConsultFollowUpVocabulary(args: {
  needsCalibration?: boolean
  needsColorHistory?: boolean
  intakePack: ConsultIntakePackDefinition
  intakeAnswers: Readonly<Record<string, string>>
  serviceName: string | null
  /** Follow-up-pack answers already recorded on earlier rounds. */
  followUpAnswers: Readonly<Record<string, readonly string[]>>
}): ConsultFollowUpVocabulary {
  const entries: ConsultFollowUpVocabularyEntry[] = []

  for (const question of args.intakePack.questions) {
    if (args.intakeAnswers[question.key]) continue
    entries.push(entry(question, 'INTAKE'))
  }

  if (args.needsColorHistory) {
    for (const question of HAIR_COLOR_INTAKE_PACK.questions) {
      if (!CONSULT_FOLLOW_UP_SAFETY_KEYS.has(question.key) || args.intakeAnswers[question.key] || args.followUpAnswers[question.key] ||
        entries.some(existing => existing.key === question.key)) continue
      entries.push(entry(question, 'FOLLOW_UP'))
    }
  }

  const followUpPack: ConsultIntakeFollowUpPackDefinition | null =
    resolveConsultIntakeFollowUpPack({
      intakePackId: args.intakePack.id,
      serviceName: args.serviceName,
    })
  for (const question of followUpPack?.questions ?? []) {
    if (args.followUpAnswers[question.key]) continue
    // A key the intake pack ALSO asks belongs to the intake, whichever pack
    // listed it second. Two homes for one key is the bug this whole module is
    // shaped to prevent, so the collision is resolved here rather than at the
    // write.
    if (entries.some((existing) => existing.key === question.key)) continue
    if (args.intakeAnswers[question.key]) continue
    entries.push(entry(question, 'FOLLOW_UP'))
  }

  if (args.needsCalibration) {
    for (const question of CONSULT_CALIBRATION_QUESTIONS) {
      if (!args.followUpAnswers[question.key]) entries.push(question)
    }
  }

  return {
    entries,
    byKey: new Map(entries.map((item) => [item.key, item])),
  }
}

/** The unanswered SAFETY questions, in pack order — what a FALLBACK asks. */
export function consultFollowUpSafetyEntries(
  vocabulary: ConsultFollowUpVocabulary,
): ConsultFollowUpVocabularyEntry[] {
  return vocabulary.entries.filter((item) => item.safety)
}
