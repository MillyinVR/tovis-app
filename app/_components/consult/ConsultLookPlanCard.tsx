'use client'
import { consultClientPlanCopy as copy } from '@/lib/brand/consultClientPlanCopy'
import ConsultProfessionalPlanForm from './ConsultProfessionalPlanForm'
import ConsultLookExpectationsForm from './ConsultLookExpectationsForm'

import { useEffect, useState } from 'react'
import type { ConsultLookPlanDTO, ConsultLookBriefVersionDTO, ConsultLookEstimateAmountDTO } from '@/lib/dto/consult'
import ConsultLookAdjustmentForm from './ConsultLookAdjustmentForm'
import { saveConsultLookBriefAction } from '@/lib/consult/lookBrief.client'
import { formatMoneyFromUnknown } from '@/lib/money'

export type ChooseConsultLook = (expectedVersion: number, pathIndex: number, locationType: 'SALON' | 'MOBILE') => void

function EstimateAmount({ amount }: { amount: ConsultLookEstimateAmountDTO }) {
  return <span>{amount.priceStatus === 'COMPLIMENTARY' ? 'Complimentary' : amount.priceStatus === 'UNSET'
    ? 'Price set at consultation' : formatMoneyFromUnknown(amount.price)}
    {' · '}{amount.durationMinutes === null ? 'Time set at consultation' : `${amount.durationMinutes} min`}</span>
}

/** Client copy stays about the result; required menu steps are pro-only. */
export default function ConsultLookPlanCard({ plan: sourcePlan, brief: savedBrief, consultId, professional = false, busy = false, onChoose }: {
  plan: ConsultLookPlanDTO
  consultId: string
  brief?: ConsultLookBriefVersionDTO
  professional?: boolean
  busy?: boolean
  onChoose?: ChooseConsultLook
}) {
  const [brief, setBrief] = useState(savedBrief)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setBrief(savedBrief) }, [savedBrief])
  async function confirm() {
    if (!brief) return
    setConfirming(true)
    setError(null)
    try {
      setBrief(await saveConsultLookBriefAction(consultId, professional, 'acknowledge', { expectedVersion: brief.version }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not confirm this look. Please try again.') }
    finally { setConfirming(false) }
  }
  const plan = brief?.professionalPlan ?? sourcePlan
  const inputClosed = brief?.inputOpen === false
  const correctionsNeedReview = Boolean(brief?.invalidatedProfessionalPlan || brief?.invalidatedAdjustments.length)
  const tier = { EXACT: 'Your look', CLOSE: copy.close, TOWARD: 'A first step toward your look' }[plan.tier]
  return (
    <section className="grid gap-3" aria-label="Your look plan">
      <div>
        <h3 className="text-base font-bold text-textPrimary">{tier}</h3>
        {(plan.provisional || brief?.awaitingAnalysis) && <p className="text-xs font-semibold text-textSecondary">
          {plan.choosable && !brief?.awaitingAnalysis ? copy.fromEarlyPhotos : copy.draft}
        </p>}
        {brief && <p className="text-xs text-textSecondary">Version {brief.version}</p>}
      </div>
      <p className="text-sm leading-6 text-textPrimary">{plan.summary}</p>
      {professional && brief && <ConsultProfessionalPlanForm key={brief.version} consultId={consultId} plan={plan} brief={brief} onSaved={setBrief} />}
      {brief?.professionalPlan && <p className="text-xs text-textSecondary">{copy.authored}</p>}
      {brief?.invalidatedProfessionalPlan && <p className="text-sm text-textSecondary">{copy.changed}</p>}
      {brief && brief.invalidatedAdjustments.length > 0 && <div className="rounded-lg border border-toneWarn/30 bg-toneWarn/10 p-3 text-sm text-textPrimary">
        <p>{copy.review}</p>
        {professional && <ul>{brief.invalidatedAdjustments.map((entry, index) => <li key={index}>Option {entry.pathIndex + 1}{entry.visitIndex !== null ? `, visit ${entry.visitIndex + 1}` : ''}: {entry.field.toLowerCase()} — {entry.value}{entry.reason ? ` (${entry.reason})` : ''}</li>)}</ul>}
      </div>}
      <ol className="grid gap-3">
        {plan.paths.map((path, pathIndex) => (
          <li key={pathIndex} className="rounded-xl border border-surfaceGlass/10 bg-bgSurface p-3">
            <h4 className="text-sm font-bold text-textPrimary">{path.title}</h4>
            <p className="mt-1 text-sm leading-6 text-textSecondary">{path.whyThisWorksForYou}</p>
            {brief?.adjustments.filter(entry => entry.pathIndex === pathIndex && entry.field === 'EXPECTATIONS').map(entry => <p key={entry.pathIndex} className="mt-2 text-sm text-textPrimary">Your pro’s note: {entry.value}</p>)}
            {professional && brief && <ConsultLookExpectationsForm key={`expectations:${brief.version}:${pathIndex}`} consultId={consultId} brief={brief} pathIndex={pathIndex} onSaved={setBrief} />}
            <p className="mt-2 text-xs text-textSecondary">{path.sessionCount === 1 ? 'Planned in one visit' : `Planned over ${path.sessionCount} visits`}</p>
            {professional && <ol className="mt-2 grid gap-1 text-xs text-textPrimary">
              {path.visits.map((visit, index) => <li key={index}>Visit {index + 1}: {visit.steps.map(step => step.serviceName).join(' + ')}</li>)}
            </ol>}
            {brief?.pathEstimates.filter(estimate => estimate.pathIndex === pathIndex).map(estimate => {
              const selected = brief.selectedPathIndex === pathIndex && brief.selectedLocationType === estimate.locationType
              const available = estimate.visits.every(visit => visit.steps.every(step => step.available))
              return <div key={estimate.locationType} className="mt-3 grid gap-1 border-t border-surfaceGlass/10 pt-3 text-xs text-textSecondary">
                <p className="font-semibold text-textPrimary">{estimate.locationType === 'SALON' ? 'At the salon' : copy.mobile}{selected ? ' · Your chosen look' : ''}</p>
                <p>First appointment: <EstimateAmount amount={estimate.firstAppointment} /></p>
                {path.sessionCount > 1 && <p>{copy.allVisits} <EstimateAmount amount={estimate.transformation} /></p>}
                {professional && estimate.visits.map((visit, visitIndex) => <div key={visitIndex} className="grid gap-2">
                  {visit.steps.map(step => <ConsultLookAdjustmentForm key={`${step.offeringId}:${brief.version}`} consultId={consultId} brief={brief}
                    target={{ pathIndex, visitIndex, offeringId: step.offeringId, locationType: estimate.locationType }}
                    label={`visit ${visitIndex + 1} — ${path.visits[visitIndex]?.steps.find(item => item.offeringId === step.offeringId)?.serviceName ?? 'required work'}`}
                    price={step.price} duration={step.durationMinutes} onSaved={setBrief} />)}
                </div>)}
                {!available && <p>Your pro needs to update this option before you can choose it.</p>}
                {onChoose && !brief.awaitingAnalysis && plan.choosable && <button type="button"
                  className="mt-2 rounded-full border border-surfaceGlass/20 px-4 py-2 text-sm font-semibold text-textPrimary disabled:opacity-50"
                  disabled={busy || !brief.confirmationOpen || correctionsNeedReview || selected || !available} aria-pressed={selected}
                  onClick={() => onChoose(brief.version, pathIndex, estimate.locationType)}>
                  {selected ? 'Look selected' : 'Choose this look'}
                </button>}
              </div>
            })}
          </li>
        ))}
      </ol>
      {brief && <div className="grid gap-1 text-xs text-textSecondary">
        {inputClosed && <p>{brief.confirmationOpen ? "Your appointment has started. Review the look with your pro before service begins." : "This version is kept for your records."}</p>}
        <p>Estimate — your pro will confirm. Tip not included.</p>
        {brief.completedVisit && <section className="mt-3 grid gap-2 border-t border-surfaceGlass/20 pt-3" aria-label="Completed visit">
          <h4 className="font-semibold text-textPrimary">Your completed visit</h4>
          <p>Final service subtotal: {brief.completedVisit.finalServiceSubtotal === null ? 'Not recorded' : formatMoneyFromUnknown(brief.completedVisit.finalServiceSubtotal)}</p>
          <p>Recorded service time: {brief.completedVisit.observedServiceMinutes === null ? 'Not recorded' : `${brief.completedVisit.observedServiceMinutes} min`}</p>
          {brief.completedVisit.aftercare && <div className="grid gap-2">
            {brief.completedVisit.aftercare.notes && <p>{brief.completedVisit.aftercare.notes}</p>}
            {brief.completedVisit.aftercare.sections.map((section, index) => <div key={index}><h5 className="font-semibold">{section.label}</h5><p>{section.body}</p></div>)}
            {brief.completedVisit.aftercare.products.map((product, index) => <p key={index}>{product.name}{product.note ? ` — ${product.note}` : ''}</p>)}
          </div>}
        </section>}
        {(brief.chartSources?.length ?? 0) > 0 && <ul>{brief.chartSources?.map(source => <li key={source.questionKey}>{source.summary}</li>)}</ul>}
        {brief.additionalClientAnswers.length > 0 && <details><summary>What you shared in follow-up</summary>
          <dl>{brief.additionalClientAnswers.map(item => <div key={item.questionKey}><dt>{item.question.replace(/^Client follow-up: /, '')}</dt><dd>{item.answer}</dd></div>)}</dl>
        </details>}
        {brief.changes.map((change, index) => <p key={index}>{change}</p>)}
        <p>{brief.clientConfirmed ? 'Client confirmed this version.' : 'Waiting for client confirmation.'} {brief.professionalConfirmed ? 'Pro confirmed this version.' : 'Waiting for pro confirmation.'}</p>
        {brief.selectedPathIndex !== null && !brief.awaitingAnalysis && <button type="button"
          className="justify-self-start rounded-full border border-surfaceGlass/20 px-4 py-2 font-semibold text-textPrimary disabled:opacity-50"
          disabled={busy || correctionsNeedReview || !brief.confirmationOpen || confirming || (professional ? brief.professionalConfirmed : brief.clientConfirmed)} onClick={() => void confirm()}>
          {confirming ? 'Confirming…' : (professional ? brief.professionalConfirmed : brief.clientConfirmed) ? 'Version confirmed' : 'Confirm this look'}
        </button>}
        {error && <p role="alert">{error}</p>}
        {professional && brief.bookingId && <a className="underline" href={`/pro/bookings/${encodeURIComponent(brief.bookingId)}/session`}>Open appointment to update reserved work and time, record products and formula, or prepare aftercare</a>}
        {brief.reservedDurationMinutes !== null && <p>Your reserved appointment: {brief.reservedDurationMinutes} min. Changes to this time need a new availability check and confirmation.</p>}
      </div>}
      <p className="text-sm font-semibold text-textPrimary">{brief?.selectedPathIndex !== null && brief?.selectedPathIndex !== undefined && !brief.awaitingAnalysis
        ? brief.clientConfirmed && brief.professionalConfirmed ? 'You both confirmed this look.' : 'Review and confirm this version together.'
        : plan.nextStep}</p>
    </section>
  )
}
