import { exactKeys } from './analysisValidation'
import { resolveConsultIntakeFollowUpPack } from './intake/followUp'
import { normalizeConsultIntakePayload } from './intake/registry'
import type { Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import type { ConsultAnalysisIntakeItem } from './analysisEngine'
import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
import { CONSULT_FOLLOW_UP_SAFETY_KEYS } from './followUpVocabulary'

export const CONSULT_LOOK_COLOR_HISTORY_QUESTIONS = HAIR_COLOR_INTAKE_PACK.questions.filter(question => CONSULT_FOLLOW_UP_SAFETY_KEYS.has(question.key))

/** Only canonical, single-answer client reports can fill a missing history key. */
export async function loadConsultLookHistory(db: Prisma.TransactionClient, consultSessionId: string) {
  const rows = await db.consultFollowUpRound.findMany({ where: { consultSessionId },
    orderBy: [{ planVersion: 'asc' }, { round: 'asc' }], select: { answers: true } })
  const intakeRevision = await db.consultRevision.findFirst({ where: { consultSessionId, kind: 'INTAKE' },
    orderBy: { revision: 'desc' }, select: { payload: true } })
  const intake = intakeRevision ? normalizeConsultIntakePayload(intakeRevision.payload) : null
  const followUp = intake ? resolveConsultIntakeFollowUpPack({ intakePackId: intake.packId, serviceName: 'a look like this' }) : null
  const byKey = new Map([...HAIR_COLOR_INTAKE_PACK.questions, ...(followUp?.questions ?? [])].map(question => [question.key, question]))
  const answers: Record<string, string> = {}
  for (const row of rows) {
    if (!isRecord(row.answers)) continue
    for (const [key, values] of Object.entries(row.answers)) {
      const question = byKey.get(key)
      if (!question || !Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string' ||
        !question.options.some(option => option.value === values[0])) continue
      answers[key] = values[0]
    }
  }
  const items: ConsultAnalysisIntakeItem[] = []
  for (const [questionKey, answerCode] of Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))) {
    const question = byKey.get(questionKey)
    const answer = question?.options.find(option => option.value === answerCode)
    if (question && answer) items.push({ questionKey, question: `Client follow-up: ${question.label}`, answerCode, answer: answer.label })
  }
  return { answers, items }
}


export function parseConsultLookHistoryItems(raw: unknown): ConsultAnalysisIntakeItem[] {
  if (!Array.isArray(raw) || raw.length > 24) throw new Error('Saved client history is unavailable.')
  return raw.map(item => {
    if (!isRecord(item) || !exactKeys(item, ['questionKey','question','answerCode','answer']) ||
      typeof item.questionKey !== 'string' || typeof item.question !== 'string' || typeof item.answerCode !== 'string' || typeof item.answer !== 'string') {
      throw new Error('Saved client history is unavailable.')
    }
    return { questionKey: item.questionKey, question: item.question, answerCode: item.answerCode, answer: item.answer }
  })
}
