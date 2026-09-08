import { describe, expect, it } from 'vitest'
import { CONSULT_INTAKE_PACKS, CONSULT_INTAKE_PACK_ARCHIVE, toConsultIntakeQuestionPackDTO, validateConsultIntakeAnswers } from './registry'
import { clientConsultQuestion } from '@/lib/brand/consultClientQuestionCopy'
import { clientConsultProfileValue } from '@/lib/brand/consultClientProfileCopy'
import * as engine from '../analysisEngine'
const vocabulary = {
 skinUndertone: engine.CONSULT_PROFILE_UNDERTONES, contrastLevel: engine.CONSULT_PROFILE_CONTRASTS, colorSeason: engine.CONSULT_PROFILE_COLOR_SEASONS, faceProportion: engine.CONSULT_PROFILE_FACE_PROPORTIONS, jawline: engine.CONSULT_PROFILE_JAWLINES, foreheadProportion: engine.CONSULT_PROFILE_FOREHEADS, featureBalance: engine.CONSULT_PROFILE_FEATURE_BALANCES, eyeColor: engine.CONSULT_PROFILE_EYE_COLORS, eyeShape: engine.CONSULT_PROFILE_EYE_SHAPES, eyeSpacing: engine.CONSULT_PROFILE_EYE_SPACINGS, browDensity: engine.CONSULT_PROFILE_BROW_DENSITIES, browShape: engine.CONSULT_PROFILE_BROW_SHAPES,
}

describe('client question presentation', () => {
  it('preserves every current and archived answer contract without mutating its pack', () => {
    for (const pack of [...CONSULT_INTAKE_PACKS, ...CONSULT_INTAKE_PACK_ARCHIVE]) {
      const before = JSON.stringify(pack)
      const dto = toConsultIntakeQuestionPackDTO(pack)
      expect(dto.version).toBe(pack.version)
      for (const [index, question] of dto.questions.entries()) {
        const original = pack.questions[index]!
        expect({ ...question, label: original.label, helpText: original.helpText,
          options: question.options.map((option, n) => ({ ...option, label: original.options[n]!.label })) }).toEqual(original)
        for (const option of question.options) {
          expect(validateConsultIntakeAnswers(pack, { [question.key]: option.value }, false).ok).toBe(true)
        }
      }
      expect(JSON.stringify(pack)).toBe(before)
    }
  })
  it('does not give non-hair questions a hair-specific meaning', () => {
    const pack = CONSULT_INTAKE_PACKS.find(pack => pack.id === 'general-service')!
    for (const question of pack.questions) expect(clientConsultQuestion(pack.id, question)).toBe(question)
  })
  it('explains every supported profile observation and keeps unknown observations uncertain', () => {
    for (const [field, values] of Object.entries(vocabulary)) {
      for (const value of values) {
        const label = clientConsultProfileValue(field, value)
        if (value !== 'UNKNOWN') expect(label).not.toBe('Couldn’t tell from the photos')
      }
    }
    expect(clientConsultProfileValue('eyeShape', 'FUTURE_VALUE')).toBe(clientConsultProfileValue('eyeShape', 'UNKNOWN'))
  })
})
