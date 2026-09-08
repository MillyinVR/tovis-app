import { ConsultActorType } from '@prisma/client'
import { expect } from 'vitest'
import { answerConsultInspirationQuestion, loadConsultInspirationState } from '@/lib/consult/inspirationContract'

/** Follow the server’s applicable image questions; never hard-code a count of crops. */
export async function answerVisualInspiration(args: {
  consultSessionId: string
  clientId: string
  actorUserId: string
  label: string
}) {
  for (let step = 0; step < 12; step += 1) {
    const state = await loadConsultInspirationState(args)
    const question = state.progress.currentQuestion
    if (!question?.key.startsWith('color_')) return
    expect(question.options.some((option) => option.value === 'not-sure')).toBe(true)
    await answerConsultInspirationQuestion({
      ...args,
      actor: { type: ConsultActorType.CLIENT, id: args.actorUserId },
      input: { schemaVersion: state.schemaVersion, questionKey: question.key, selectedValues: ['not-sure'], idempotencyKey: `${args.label}-visual-${step}` },
    })
  }
  throw new Error('The visual consultation did not converge.')
}
