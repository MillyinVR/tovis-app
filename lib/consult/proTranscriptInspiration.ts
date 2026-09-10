import type { Prisma } from '@prisma/client'
import { defaultClientConsultInspirationCopy as copy } from '@/lib/brand/defaultClientConsultInspirationCopy'
import { CONSULT_INSPIRATION_QUESTIONS, normalizeStoredInspirationPayload } from './inspirationPack'
import { findConsultInspirationPack, consultInspirationQuestionLabel, consultInspirationOptionLabel } from './inspiration/registry'

/** Keep neutral answers too: the brief's exact-detail projection intentionally omits them. */
export function projectTranscriptInspiration(payload: Prisma.JsonValue): Array<{ label: string; value: string }> {
  const review = normalizeStoredInspirationPayload(payload)
  if (!review) return []
  const pack = review.packId !== null && review.packVersion !== null ? findConsultInspirationPack(review.packId, review.packVersion) : null
  return review.answers.map(answer => {
    const question = pack?.questions.find(question => question.key === answer.questionKey)
    const legacy = !pack ? CONSULT_INSPIRATION_QUESTIONS.find(question => question.key === answer.questionKey) : null
    const label = question && pack ? consultInspirationQuestionLabel(pack, question, copy) : legacy?.label ?? answer.questionKey
    const values = answer.selectedValues.map(value => {
      if (question) {
        const option = question.options.find(option => option.value === value)
        return option ? consultInspirationOptionLabel(question, option, copy) : value
      }
      return legacy?.options.find(option => option.value === value)?.label ?? value
    })
    if (answer.text) values.push(answer.text)
    return { label, value: values.join(' · ') }
  })
}
