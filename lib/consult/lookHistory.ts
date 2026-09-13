import { exactKeys } from './analysisValidation'
import { resolveConsultIntakeFollowUpPack } from './intake/followUp'
import { normalizeConsultIntakePayload } from './intake/registry'
import type { ConsultIntakeQuestionDTO } from '@/lib/dto/consult'
import type { Prisma } from '@prisma/client'
import { isRecord } from '@/lib/guards'
import type { ConsultAnalysisIntakeItem } from './analysisEngine'
import { HAIR_COLOR_INTAKE_PACK } from './intake/packs/hairColor'
import { CONSULT_FOLLOW_UP_SAFETY_KEYS } from './followUpVocabulary'
import { readStoredConsultClientText } from './clientText'
import { CONSULT_INTAKE_CLIENT_WORDS_VALUE } from './intake/types'

export const CONSULT_LOOK_COLOR_HISTORY_QUESTIONS = HAIR_COLOR_INTAKE_PACK.questions.filter(question => CONSULT_FOLLOW_UP_SAFETY_KEYS.has(question.key))

/**
 * Shared validation for history reads and source-dated chart projections.
 *
 * `text` is the round's client-authored sidecar. A key answered in her OWN
 * WORDS carries the `client-words` code, which is in no question's option list
 * — without the sidecar it would be dropped here, and the sentence she typed
 * would reach nobody.
 */
export function canonicalConsultHistoryAnswers(
  raw: unknown,
  questions: readonly ConsultIntakeQuestionDTO[],
  text: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!isRecord(raw)) return result
  for (const [key, values] of Object.entries(raw)) {
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') continue
    const value = values[0]
    const question = questions.find(candidate => candidate.key === key)
    if (!question) continue
    const typed = value === CONSULT_INTAKE_CLIENT_WORDS_VALUE && question.allowText && Boolean(text[key])
    if (typed || question.options.some(option => option.value === value)) result[key] = value
  }
  return result
}

/** Only canonical, single-answer client reports can fill a missing history key. */
export async function loadConsultLookHistory(db: Prisma.TransactionClient, consultSessionId: string) {
  const rows = await db.consultFollowUpRound.findMany({ where: { consultSessionId },
    orderBy: [{ planVersion: 'asc' }, { round: 'asc' }], select: { answers: true, clientTextAnswers: true } })
  const intakeRevision = await db.consultRevision.findFirst({ where: { consultSessionId, kind: 'INTAKE' },
    orderBy: { revision: 'desc' }, select: { payload: true } })
  const intake = intakeRevision ? normalizeConsultIntakePayload(intakeRevision.payload) : null
  const followUp = intake ? resolveConsultIntakeFollowUpPack({ intakePackId: intake.packId, serviceName: 'a look like this' }) : null
  const byKey = new Map([...HAIR_COLOR_INTAKE_PACK.questions, ...(followUp?.questions ?? [])].map(question => [question.key, question]))
  const answers: Record<string, string> = {}
  const textAnswers: Record<string, string> = {}
  for (const row of rows) {
    const rowText = readStoredConsultClientText(row.clientTextAnswers)
    Object.assign(answers, canonicalConsultHistoryAnswers(row.answers, [...byKey.values()], rowText))
    for (const [key, note] of Object.entries(rowText)) {
      if (answers[key]) textAnswers[key] = note
    }
  }
  const items: ConsultAnalysisIntakeItem[] = []
  for (const [questionKey, answerCode] of Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))) {
    const question = byKey.get(questionKey)
    if (!question) continue
    const clientWords = textAnswers[questionKey]
    // 🔴 Her own words are the whole answer on the escape hatch. Falling
    // through to the option lookup would drop the one thing she chose to say.
    if (answerCode === CONSULT_INTAKE_CLIENT_WORDS_VALUE) {
      if (!clientWords) continue
      items.push({ questionKey, question: `Client follow-up: ${question.label}`, answerCode, answer: clientWords, clientWords })
      continue
    }
    const answer = question.options.find(option => option.value === answerCode)
    if (answer) {
      items.push({ questionKey, question: `Client follow-up: ${question.label}`, answerCode, answer: answer.label,
        ...(clientWords ? { clientWords } : {}) })
    }
  }
  return { answers, textAnswers, items }
}


/**
 * The stored form of a history item — EXACTLY the four keys it has always had.
 *
 * 🔴 `clientWords` is deliberately dropped on the way in. `ConsultLookBriefVersion.
 * additionalClientAnswers` is read back by `parseConsultLookHistoryItems`, which
 * refuses any key it does not know; a fifth key would therefore 500 the
 * professional's plan read on a ROLLED-BACK deployment, for a consult where she
 * had typed. The array's shape is frozen for that reason.
 *
 * Nothing is lost where it matters. On the ESCAPE HATCH her sentence IS
 * `answer`, so it is stored. A NOTE beside a tapped option on a follow-up card
 * is not repeated here — it still reaches the model (the live items below carry
 * it), the thread renders it back to her, and the professional's own brief
 * carries every intake note through `clientIntake`.
 */
export function consultLookHistoryStoredItems(
  items: readonly ConsultAnalysisIntakeItem[],
): ConsultAnalysisIntakeItem[] {
  return items.map(({ questionKey, question, answerCode, answer }) => ({
    questionKey, question, answerCode, answer,
  }))
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
