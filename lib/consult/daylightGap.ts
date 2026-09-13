// lib/consult/daylightGap.ts
//
// "We aren't having her add that for funsies" (Tori, 2026-09-13).
//
// A consult built on the early selfie alone comes back with real answers for
// the things a selfie CAN show and UNKNOWN for the rest — and until now the
// client saw only the second half of that, as a wall of "unknown" with no
// explanation and nothing to do about it. That reads as the app failing, when
// what actually happened is that she has not sent the photographs yet.
//
// This turns the UNKNOWNs into the one useful sentence they support: here is
// what the daylight photos would settle. It is the same rule-8 idea as
// `photoLight` (lib/consult/clientResults.ts) — the consult says what it could
// not see rather than filling the gap — one step further: it says what WOULD
// let it see.
//
// 🔴 Every claim here is DERIVED, never assumed. A group is reported only when
// BOTH are true:
//   * at least one of its observations actually came back UNKNOWN, and
//   * the views that would settle it are actually missing.
// A client who sent everything and still got an UNKNOWN is told nothing here,
// because no photograph she can take would change it — promising otherwise
// would be the app inventing a reason for its own gap.
import type {
  ConsultAnalysisObservationDTO,
  ConsultBriefAiObservationsDTO,
  ConsultCaptureShotKeyDTO,
  ConsultDaylightUnlockDTO,
  ConsultResultsDaylightGapDTO,
} from '@/lib/dto/consult'

import { isSupportedConsultObservation } from './analysisValidation'

type Observation = ConsultAnalysisObservationDTO<string>

/**
 * What each group needs to be answered, and which observations it covers.
 *
 * The view lists mirror the analysis prompts and their sanitizers
 * (lib/consult/analysisEngine.ts) — the levels may be read only from a hair
 * view, colour only from a trustworthy face view, and the fine eye and brow
 * work prefers the close-up. If one of those rules moves, this moves with it,
 * or the sentence starts promising something a photograph will not deliver.
 */
const UNLOCK_RULES: ReadonlyArray<{
  unlock: ConsultDaylightUnlockDTO
  /** Any ONE of these landing would settle the group. */
  views: readonly ConsultCaptureShotKeyDTO[]
  /** Where to look for the UNKNOWNs, by source and key. */
  hair?: readonly (keyof ConsultBriefAiObservationsDTO)[]
  profile?: readonly string[]
}> = [
  {
    unlock: 'HAIR_LEVELS',
    views: ['hair_back', 'hair_left', 'hair_right', 'hair_crown'],
    hair: ['baseLevel', 'lightestLevel'],
  },
  {
    unlock: 'HAIR_TONE_AND_CONDITION',
    views: ['hair_back', 'hair_left', 'hair_right', 'hair_crown'],
    hair: ['currentTone', 'visibleCondition', 'density', 'texture'],
  },
  {
    unlock: 'SKIN_TONE_AND_SEASON',
    views: ['face_front', 'face_side'],
    profile: ['skinUndertone', 'colorSeason', 'contrastLevel', 'skinDepth', 'surfaceOvertone'],
  },
  {
    unlock: 'EYE_AND_BROW_DETAIL',
    views: ['eyes_closeup', 'face_front'],
    profile: ['eyeShape', 'eyeSpacing', 'browDensity', 'browShape', 'eyeColor'],
  },
]

function isObservation(value: unknown): value is Observation {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { value?: unknown }).value === 'string' &&
    typeof (value as { confidence?: unknown }).confidence === 'object'
  )
}

/**
 * What the daylight photographs would still add to THIS reading.
 *
 * `acceptedShotKeys` is the views that actually fed the analysis — rejected
 * frames are not inputs, so counting them would describe photographs the
 * reading never saw (the same rule `photoLightFor` follows).
 */
export function consultDaylightGap(args: {
  /**
   * Both sources are stored JSON read back from an immutable revision, so a
   * historical payload may simply not carry one of them. Absent is not an
   * error: no observation found means no UNKNOWN found, which means nothing is
   * claimed — the same honest answer as "she already sent that photograph".
   * Crashing the results page over a missing key would be the worse failure.
   */
  profile: Readonly<Record<string, unknown>> | undefined
  aiObservations: Readonly<Record<string, unknown>> | undefined
  acceptedShotKeys: readonly ConsultCaptureShotKeyDTO[]
  /** The views this consult's pack defines — nothing outside it can be asked for. */
  packShotKeys: readonly ConsultCaptureShotKeyDTO[]
}): ConsultResultsDaylightGapDTO {
  const profile = args.profile ?? {}
  const aiObservations = args.aiObservations ?? {}
  const accepted = new Set<string>(args.acceptedShotKeys)
  const pack = new Set<string>(args.packShotKeys)

  const observationsFor = (rule: (typeof UNLOCK_RULES)[number]): Observation[] => {
    const found: Observation[] = []
    for (const key of rule.hair ?? []) {
      const value = aiObservations[key]
      if (isObservation(value)) found.push(value)
    }
    for (const key of rule.profile ?? []) {
      const value = profile[key]
      if (isObservation(value)) found.push(value)
    }
    return found
  }

  const unlocks: ConsultDaylightUnlockDTO[] = []
  const missing = new Set<ConsultCaptureShotKeyDTO>()
  for (const rule of UNLOCK_RULES) {
    // Only views this pack actually serves can be offered as the answer.
    const askable = rule.views.filter((view) => pack.has(view))
    if (askable.length === 0) continue
    // One landed view is enough to settle the group — if any is in, the
    // remaining UNKNOWNs are not a photograph problem and we say nothing.
    if (askable.some((view) => accepted.has(view))) continue
    const observations = observationsFor(rule)
    if (!observations.some((observation) => observation.value === 'UNKNOWN')) continue
    unlocks.push(rule.unlock)
    for (const view of askable) missing.add(view)
  }

  // What she DID buy: readings that exist but are held below the plan-carrying
  // floor, which is what a selfie-backed observation looks like
  // (`CONSULT_PROVISIONAL_CONFIDENCE_MAX`). Counted across both sources.
  const provisionalCount = [
    ...Object.values(profile),
    ...Object.values(aiObservations),
  ].filter(
    (value) =>
      isObservation(value) &&
      value.value !== 'UNKNOWN' &&
      !isSupportedConsultObservation(value),
  ).length

  return {
    missingShotKeys: [...missing],
    unlocks,
    provisionalCount,
  }
}
