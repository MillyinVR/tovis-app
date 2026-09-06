// lib/consult/planDiff.ts
//
// P7a-3 — what changed between two plan versions, said in the client's words.
//
// ONE function, two audiences. The thread's "plan updated" bubble and the pro's
// Brief both show a diff, and they must show the SAME diff: a client told her
// plan went from two sessions to three, next to a pro whose Brief still reads
// two, is the exact failure the versioned Brief exists to prevent (handoff
// Part 5, P10: "notifies the pro with a diff").
//
// ## What is compared, and what deliberately is not
//
// Compared: the things a person would notice and act on — how achievable the
// look is, what would be done and in what order, and any safety finding. Those
// are the plan.
//
// Not compared: prose that the model rewrites every run without changing its
// meaning (`rationale`, `achievabilityReason`, the service-lens paragraphs) and
// per-field confidences. Diffing those would produce a "your plan changed"
// bubble on every single rerun, including the ones that changed nothing — and a
// notification that always fires is a notification nobody reads.
//
// 🔴 An EMPTY diff is a real result, not a bug, and callers must render it
// rather than hide it. "We looked again and it still holds" is reassurance the
// client earned by editing; showing nothing would look like her edit was
// dropped.

import 'server-only'

import type {
  ConsultAnalysisPayloadDTO,
  ConsultPlanDiffEntryDTO,
} from '@/lib/dto/consult'
import type { BrandClientConsultPlanDiffCopy } from '@/lib/brand/types'

/**
 * Achievability, as a sentence rather than an enum.
 *
 * The copy table owns the words; this owns which word. `UNKNOWN` is a real
 * answer here (the analysis could not tell) and gets its own line rather than
 * being flattened to null, because "we are no longer sure" is a change worth
 * knowing about.
 */
function achievabilityLabel(
  copy: BrandClientConsultPlanDiffCopy,
  value: ConsultAnalysisPayloadDTO['serviceLens']['achievability'],
): string {
  switch (value) {
    case 'LIKELY_SINGLE_APPOINTMENT':
      return copy.achievabilitySingle
    case 'LIKELY_MULTI_APPOINTMENT':
      return copy.achievabilityMulti
    case 'REQUIRES_PRO_ASSESSMENT':
      return copy.achievabilityAssessment
    default:
      return copy.achievabilityUnknown
  }
}

/**
 * The ordered list of what would be done.
 *
 * Order is part of the plan — "gloss first, then lighten" is a different plan
 * from the reverse — so this joins rather than sorts. A non-service
 * recommendation (an explanation, a "see this pro" outcome) contributes its
 * title, which is what the client was shown.
 */
function planSteps(analysis: ConsultAnalysisPayloadDTO): string[] {
  return analysis.recommendations.map(
    (entry) => entry.serviceName ?? entry.title,
  )
}

function safetyCodes(analysis: ConsultAnalysisPayloadDTO): string[] {
  return analysis.safetyFlags.map((flag) => flag.code)
}

function levelLabel(
  observation: ConsultAnalysisPayloadDTO['core']['baseLevel'],
): string | null {
  return observation.value === 'UNKNOWN' ? null : String(observation.value)
}

/**
 * Compare two plan versions.
 *
 * `previous` is the older payload, `next` the newer. Returns the lines that
 * actually moved, in the order a person would want to read them: how big a job
 * it is, then what the job is, then anything to talk to the pro about, then the
 * starting point the whole thing rests on.
 */
export function diffConsultPlans(args: {
  previous: ConsultAnalysisPayloadDTO
  next: ConsultAnalysisPayloadDTO
  copy: BrandClientConsultPlanDiffCopy
}): ConsultPlanDiffEntryDTO[] {
  const { previous, next, copy } = args
  const entries: ConsultPlanDiffEntryDTO[] = []

  const wasAchievability = achievabilityLabel(copy, previous.serviceLens.achievability)
  const nowAchievability = achievabilityLabel(copy, next.serviceLens.achievability)
  if (wasAchievability !== nowAchievability) {
    entries.push({
      key: 'achievability',
      label: copy.achievabilityLabel,
      from: wasAchievability,
      to: nowAchievability,
    })
  }

  const wasSteps = planSteps(previous)
  const nowSteps = planSteps(next)
  // 🔴 Compared on a NUL, displayed on the copy table's separator. Comparing
  // on the display separator would call ["Gloss, then tone", "Cut"] and
  // ["Gloss", "then tone, Cut"] equal — two different plans reported as no
  // change at all.
  if (wasSteps.join('\u0000') !== nowSteps.join('\u0000')) {
    entries.push({
      key: 'steps',
      label: copy.stepsLabel,
      from: wasSteps.length > 0 ? wasSteps.join(copy.stepSeparator) : null,
      to: nowSteps.length > 0 ? nowSteps.join(copy.stepSeparator) : null,
    })
  }

  const wasSafety = safetyCodes(previous)
  const nowSafety = safetyCodes(next)
  const added = nowSafety.filter((code) => !wasSafety.includes(code))
  const removed = wasSafety.filter((code) => !nowSafety.includes(code))
  if (added.length > 0 || removed.length > 0) {
    entries.push({
      key: 'safety',
      label: copy.safetyLabel,
      // Counts, not codes: the codes are a routing vocabulary, and the flags
      // themselves are already on screen in the plan card with their own
      // summaries. This line says "there is something new to read", and the
      // client reads it there.
      from: String(wasSafety.length),
      to: String(nowSafety.length),
    })
  }

  // The starting point last: it changes when she adds a better photo, and it is
  // the reason the rest of the diff moved rather than a change in its own right.
  const wasBase = levelLabel(previous.core.baseLevel)
  const nowBase = levelLabel(next.core.baseLevel)
  if (wasBase !== nowBase) {
    entries.push({
      key: 'baseLevel',
      label: copy.baseLevelLabel,
      from: wasBase,
      to: nowBase,
    })
  }

  const wasLightest = levelLabel(previous.core.lightestLevel)
  const nowLightest = levelLabel(next.core.lightestLevel)
  if (wasLightest !== nowLightest) {
    entries.push({
      key: 'lightestLevel',
      label: copy.lightestLevelLabel,
      from: wasLightest,
      to: nowLightest,
    })
  }

  return entries
}
