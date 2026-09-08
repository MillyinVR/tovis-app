import { Prisma, type ServiceLocationType } from '@prisma/client'
import { bookingError } from '@/lib/booking/errors'
import { isRecord } from '@/lib/guards'
import { normalizeConsultLookPathEstimates } from './lookPathEstimate'
import { parseConsultLookAdjustments } from './lookAdjustments'

/** Server-owned timing for the existing propose/approve availability boundary. */
export async function loadLookBookingMaterialization(tx: Prisma.TransactionClient, args: {
  consultSessionId: string | null | undefined
  locationType: ServiceLocationType
  /** Undefined when authoring; approval must echo the stored version exactly. */
  approvingProposal?: unknown
}): Promise<{ versionId: string; durations: ReadonlyMap<string, number> } | null> {
  if (!args.consultSessionId) return null
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsultSession" WHERE id = ${args.consultSessionId} FOR UPDATE`)
  const brief = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId: args.consultSessionId }, orderBy: { version: 'desc' } })
  if (!brief) return null
  if (parseConsultLookAdjustments(brief.invalidatedAdjustments).length || brief.awaitingAnalysis || brief.invalidatedProfessionalPlan !== null || brief.selectedPathIndex === null || brief.selectedLocationType !== args.locationType ||
    (args.approvingProposal !== undefined && (!isRecord(args.approvingProposal) || args.approvingProposal.lookBriefVersionId !== brief.id))) {
    throw bookingError('INVALID_SERVICE_ITEMS', { userMessage: 'The look brief changed. Review the current version and send a new appointment proposal.' })
  }
  const estimate = normalizeConsultLookPathEstimates(brief.pathEstimates).find(item => item.pathIndex === brief.selectedPathIndex && item.locationType === args.locationType)
  const steps = estimate?.visits[0]?.steps
  if (!steps?.length || steps.some(step => !step.available || step.durationMinutes === null || step.price === null)) {
    throw bookingError('INVALID_SERVICE_ITEMS', { userMessage: 'Confirm the required work, price and time in the look brief first.' })
  }
  return { versionId: brief.id, durations: new Map(steps.flatMap(step => step.durationMinutes === null ? [] : [[step.offeringId, step.durationMinutes]])) }
}
