import type { ConsultLookPathEstimateDTO } from '@/lib/dto/consult'
import { formatMoneyFromUnknown } from '@/lib/money'

/** Outcome totals are client-safe; menu names stay in the professional view. */
export function describeLookEstimateChanges(before: readonly ConsultLookPathEstimateDTO[], after: readonly ConsultLookPathEstimateDTO[]): string[] {
  const changes: string[] = []
  for (const estimate of after) {
    const prior = before.find(item => item.pathIndex === estimate.pathIndex && item.locationType === estimate.locationType)
    if (!prior) continue
    const location = estimate.locationType === 'SALON' ? 'at the salon' : 'for a mobile appointment'
    const label = `Option ${estimate.pathIndex + 1}, first appointment ${location}`
    if (prior.firstAppointment.price !== estimate.firstAppointment.price) changes.push(`${label}: estimate changed from ${
      prior.firstAppointment.price === null ? 'set at consultation' : formatMoneyFromUnknown(prior.firstAppointment.price)} to ${
      estimate.firstAppointment.price === null ? 'set at consultation' : formatMoneyFromUnknown(estimate.firstAppointment.price)}.`)
    if (prior.firstAppointment.durationMinutes !== estimate.firstAppointment.durationMinutes) changes.push(`${label}: planned time changed from ${
      prior.firstAppointment.durationMinutes === null ? 'set at consultation' : `${prior.firstAppointment.durationMinutes} min`} to ${
      estimate.firstAppointment.durationMinutes === null ? 'set at consultation' : `${estimate.firstAppointment.durationMinutes} min`}.`)
    if (prior.visits.length !== estimate.visits.length) changes.push(`Option ${estimate.pathIndex + 1}: the plan changed from ${prior.visits.length} to ${estimate.visits.length} visits.`)
  }
  return changes
}

/** Preserve the actual before/after expectation, without internal menu labels. */
export function describeLookExpectationChanges(
  before: readonly import('./lookAdjustments').ConsultLookAdjustment[],
  after: readonly import('./lookAdjustments').ConsultLookAdjustment[],
): string[] {
  return after.filter(entry => entry.field === 'EXPECTATIONS').flatMap(entry => {
    const prior = before.find(item => item.field === 'EXPECTATIONS' && item.pathIndex === entry.pathIndex)
    if (prior?.value === entry.value) return []
    return [prior
      ? `Option ${entry.pathIndex + 1}: expected result changed from “${prior.value}” to “${entry.value}”.`
      : `Option ${entry.pathIndex + 1}: your pro clarified the expected result: “${entry.value}”.`]
  })
}
