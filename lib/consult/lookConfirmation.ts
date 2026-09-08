import { Prisma } from '@prisma/client'
import { consultLinkedBooking, resolveConsultInputWindow, type ConsultOpenWindowSession } from './openWindow'
import { normalizeConsultLookPathEstimates } from './lookPathEstimate'
import { parseConsultLookAdjustments } from './lookAdjustments'

/** Arrival can confirm a prepared version without reopening client edits. */
export async function consultLookConfirmationOpen(tx: Prisma.TransactionClient, session: ConsultOpenWindowSession): Promise<boolean> {
  const window = resolveConsultInputWindow(session)
  if (window.open) return true
  if (window.reason !== 'APPOINTMENT_STARTED') return false
  const linked = consultLinkedBooking(session)
  if (!linked || !['ACCEPTED','IN_PROGRESS'].includes(linked.status)) return false
  const booking = await tx.booking.findUnique({ where: { id: linked.id }, select: { sessionStep: true } })
  return Boolean(booking && ['NONE','CONSULTATION','CONSULTATION_PENDING_CLIENT','BEFORE_PHOTOS'].includes(booking.sessionStep))
}

/** Run under the booking lock before hands-on service begins. */
export async function consultLookServiceReadiness(tx: Prisma.TransactionClient, consultSessionId: string, bookingId: string): Promise<string | null> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ConsultSession" WHERE id = ${consultSessionId} FOR UPDATE`)
  const version = await tx.consultLookBriefVersion.findFirst({ where: { consultSessionId }, orderBy: { version: 'desc' } })
  if (!version) return null // Historical consultations keep their existing approval path.
  if (version.awaitingAnalysis || version.invalidatedProfessionalPlan !== null || parseConsultLookAdjustments(version.invalidatedAdjustments).length ||
    !version.clientAcknowledgedAt || !version.professionalAcknowledgedAt || version.selectedPathIndex === null || !version.selectedLocationType) {
    return 'The client and pro must confirm the current look brief before service begins.'
  }
  const estimate = normalizeConsultLookPathEstimates(version.pathEstimates).find(item => item.pathIndex === version.selectedPathIndex && item.locationType === version.selectedLocationType)
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: {
    totalDurationMinutes: true, locationType: true, serviceItems: { select: { offeringId: true, priceSnapshot: true } },
  } })
  if (!estimate || estimate.firstAppointment.price === null || estimate.firstAppointment.durationMinutes === null || booking.locationType !== version.selectedLocationType ||
    estimate.firstAppointment.durationMinutes > booking.totalDurationMinutes ||
    !estimate.visits[0]?.steps.every(step => booking.serviceItems.some(item => item.offeringId === step.offeringId && step.price !== null && item.priceSnapshot.equals(step.price)))) {
    return 'Update this appointment’s required work, agreed prices and reserved time, with an availability check, before starting the confirmed look.'
  }
  return null
}
