import 'server-only'
import type { Prisma } from '@prisma/client'
import { consultIntakeItems, findConsultIntakePack, normalizeConsultIntakePayload } from './intake/registry'
import { normalizeStoredInspirationPayload } from './inspirationPack'
import type { ConsultBriefClientIntakeItemDTO } from '@/lib/dto/consult'

/** Diffs belong inside the consented brief, never in notification bodies. */
export async function describeLookRefinement(tx: Prisma.TransactionClient, args: {
  consultSessionId: string
  previousCreatedAt: Date
  previousAnswers: readonly Pick<ConsultBriefClientIntakeItemDTO, 'questionKey' | 'question' | 'answer'>[]
  answers: readonly Pick<ConsultBriefClientIntakeItemDTO, 'questionKey' | 'question' | 'answer'>[]
}): Promise<string[]> {
  const changes: string[] = []
  function compare(before: readonly Pick<ConsultBriefClientIntakeItemDTO, 'questionKey' | 'question' | 'answer'>[], after: readonly Pick<ConsultBriefClientIntakeItemDTO, 'questionKey' | 'question' | 'answer'>[]) {
    for (const prior of before) {
      if (!after.some(item => item.questionKey === prior.questionKey)) changes.push(`${prior.question}: “${prior.answer}” is no longer selected.`)
    }
    for (const item of after) {
      const prior = before.find(previous => previous.questionKey === item.questionKey)
      if (prior?.answer === item.answer) continue
      changes.push(`${item.question.replace(/^Client follow-up: /, '')}: ${prior ? `“${prior.answer}” → ` : ''}“${item.answer}”.`)
    }
  }
  const intakeRevisions = await tx.consultRevision.findMany({ where: { consultSessionId: args.consultSessionId, kind: 'INTAKE' }, orderBy: { revision: 'desc' }, take: 2 })
  const latestIntake = intakeRevisions[0]
  if (latestIntake && latestIntake.createdAt > args.previousCreatedAt) {
    const items = (raw: Prisma.JsonValue | undefined) => {
      const intake = raw ? normalizeConsultIntakePayload(raw) : null
      const pack = intake ? findConsultIntakePack(intake.packId, intake.packVersion) : null
      return intake && pack ? consultIntakeItems(pack, intake.answers) : []
    }
    compare(items(intakeRevisions[1]?.payload), items(latestIntake.payload))
  }
  const referenceRevisions = await tx.consultRevision.findMany({ where: { consultSessionId: args.consultSessionId, kind: 'INSPIRATION' }, orderBy: { revision: 'desc' }, take: 2 })
  const latestReference = referenceRevisions[0]
  if (latestReference && latestReference.createdAt > args.previousCreatedAt) {
    const before = referenceRevisions[1] ? normalizeStoredInspirationPayload(referenceRevisions[1].payload) : null
    const after = normalizeStoredInspirationPayload(latestReference.payload)
    if (before?.inspirationId !== after?.inspirationId) changes.push('The inspiration image changed.')
    const items = (reference: typeof after): Pick<ConsultBriefClientIntakeItemDTO, 'questionKey' | 'question' | 'answer'>[] => {
      const grouped = new Map<string, string[]>()
      for (const detail of reference?.exactClientDetails ?? []) {
        const label = detail.sentiment === 'LIKE' ? 'Likes' : detail.sentiment === 'DISLIKE' ? 'Avoids' : detail.sentiment === 'GOAL' ? 'Wants' : 'Inspiration context'
        grouped.set(label, [...(grouped.get(label) ?? []), detail.clientWords])
      }
      return [...grouped].map(([question, words]) => ({ questionKey: question, question, answer: words.join('; ') }))
    }
    compare(items(before), items(after))
  }
  compare(args.previousAnswers, args.answers)
  return changes.slice(0, 30)
}
