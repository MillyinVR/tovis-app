import type { ConsultAnalysisFeatureProfileDTO, ConsultBriefClientIntakeItemDTO } from '@/lib/dto/consult'
import { isRecord } from '@/lib/guards'
import type { ConsultFollowUpVocabularyEntry } from './followUpVocabulary'

// These are client reports to discuss, never replacements for photo evidence
// or a diagnosis of undertone. This experiment is disabled by default.
export const CONSULT_CALIBRATION_QUESTIONS: readonly ConsultFollowUpVocabularyEntry[] = [
  {
    key: 'color_jewelry_preference',
    home: 'FOLLOW_UP',
    packLabel: 'Which jewelry finish do you usually enjoy wearing?',
    safety: false,
    allowText: true,
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
      { value: 'both', label: 'Both' },
      { value: 'unsure', label: 'Not sure or prefer to skip' },
    ],
  },
  {
    key: 'color_sun_response',
    home: 'FOLLOW_UP',
    packLabel: 'From past experience, do you usually tan, burn, or both? No need to test this.',
    safety: false,
    allowText: true,
    options: [
      { value: 'tan', label: 'Usually tan' },
      { value: 'burn', label: 'Usually burn' },
      { value: 'both', label: 'Both' },
      { value: 'unsure', label: 'Not sure or prefer to skip' },
    ],
  },
]

export function needsConsultProfileCalibration(
  profile: ConsultAnalysisFeatureProfileDTO | null,
  enabled: boolean,
): boolean {
  if (!enabled || !profile) return false
  return [profile.skinUndertone, profile.contrastLevel].every(
    (observation) => observation.value === 'UNKNOWN' || observation.confidence.max <= 0.35,
  )
}

/** Present these as later client reports; never mutate the observed profile. */
export function consultCalibrationAnswerItems(
  rounds: readonly { answers: unknown }[],
): ConsultBriefClientIntakeItemDTO[] {
  const answers = new Map<string, string>()
  for (const round of rounds) {
    if (!isRecord(round.answers)) continue
    for (const question of CONSULT_CALIBRATION_QUESTIONS) {
      const selected = round.answers[question.key]
      if (!Array.isArray(selected) || selected.length !== 1) continue
      const option = question.options.find((item) => item.value === selected[0])
      if (option) answers.set(question.key, option.value)
    }
  }
  return CONSULT_CALIBRATION_QUESTIONS.flatMap((question) => {
    const option = question.options.find((item) => item.value === answers.get(question.key))
    return option ? [{
      questionKey: question.key,
      question: `Optional follow-up (client-reported, not a color diagnosis): ${question.packLabel}`,
      answerCode: option.value,
      answer: option.label,
    }] : []
  })
}
