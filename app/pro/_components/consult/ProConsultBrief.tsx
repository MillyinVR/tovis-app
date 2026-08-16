import type { ConsultProBriefDTO } from '@/lib/dto/consult'
import { formatInTimeZone } from '@/lib/time'

import ConsultBriefFeedbackButtons from './ConsultBriefFeedbackButtons'

function labelCode(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function Observation({
  label,
  value,
  confidence,
}: {
  label: string
  value: string
  confidence: { min: number; max: number }
}) {
  return (
    <li className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-textMuted">
        {label}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-textPrimary">
        {labelCode(value)}{' '}
        <span className="font-normal text-textMuted">
          · {Math.round(confidence.min * 100)}–{Math.round(confidence.max * 100)}%
          confidence
        </span>
      </div>
    </li>
  )
}

export default function ProConsultBrief({
  brief,
  timeZone,
  showDate = false,
  feedbackEnabled = true,
}: {
  brief: ConsultProBriefDTO
  timeZone: string
  showDate?: boolean
  feedbackEnabled?: boolean
}) {
  const observations = brief.aiObservations
  const level = observations.currentLevel
  const levelValue =
    level.min == null || level.max == null
      ? 'Unknown'
      : level.min === level.max
        ? `Level ${level.min}`
        : `Levels ${level.min}–${level.max}`

  return (
    <article className="grid gap-5" data-consult-brief-id={brief.briefRevisionId}>
      {showDate ? (
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-textMuted">
          {formatInTimeZone(new Date(brief.createdAt), timeZone, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
      ) : null}

      <section aria-labelledby={`${brief.consultId}-client-words`}>
        <h3
          id={`${brief.consultId}-client-words`}
          className="text-[14px] font-black text-textPrimary"
        >
          Client&apos;s words
        </h3>
        <dl className="mt-2 grid gap-2">
          {brief.clientIntake.map((item) => (
            <div key={item.questionKey} className="grid gap-0.5">
              <dt className="text-[11px] font-semibold text-textMuted">
                {item.question}
              </dt>
              <dd className="text-[13px] font-semibold text-textPrimary">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby={`${brief.consultId}-ai-observations`}>
        <h3
          id={`${brief.consultId}-ai-observations`}
          className="text-[14px] font-black text-textPrimary"
        >
          AI observations
        </h3>
        <p className="mt-1 text-[12px] text-textSecondary">
          Photo-based observations to verify in person.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-textMuted">
              Current level
            </div>
            <div className="mt-1 text-[13px] font-semibold text-textPrimary">
              {levelValue}{' '}
              <span className="font-normal text-textMuted">
                · {Math.round(level.confidence.min * 100)}–
                {Math.round(level.confidence.max * 100)}% confidence
              </span>
            </div>
          </li>
          <Observation label="Tone" {...observations.currentTone} />
          <Observation
            label="Visible condition"
            {...observations.visibleCondition}
          />
          <Observation label="Density" {...observations.density} />
          <Observation label="Texture" {...observations.texture} />
        </ul>
        <dl className="mt-3 grid gap-2 text-[12.5px]">
          {[
            ['Goal summary', observations.goalSummary],
            ['History summary', observations.historySummary],
            ['Constraints', observations.constraintsSummary],
            ['Maintenance', observations.maintenanceSummary],
            ['Appointment context', observations.appointmentContextSummary],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="font-bold text-textMuted">{label}</dt>
              <dd className="text-textPrimary">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className="rounded-xl border border-toneWarn/30 bg-toneWarn/10 p-3"
        aria-labelledby={`${brief.consultId}-safety`}
      >
        <h3
          id={`${brief.consultId}-safety`}
          className="text-[14px] font-black text-textPrimary"
        >
          Safety flags
        </h3>
        {brief.safetyFlags.length ? (
          <ul className="mt-2 grid gap-2">
            {brief.safetyFlags.map((flag) => (
              <li key={flag.code} className="text-[12.5px] text-textPrimary">
                <span className="font-black">{labelCode(flag.code)}:</span>{' '}
                {flag.summary} Discuss with the professional before service.
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] text-textSecondary">
            No flags were identified by this analysis. Confirm history and
            suitability in person before service.
          </p>
        )}
      </section>

      <section aria-labelledby={`${brief.consultId}-directions`}>
        <h3
          id={`${brief.consultId}-directions`}
          className="text-[14px] font-black text-textPrimary"
        >
          Directions to discuss
        </h3>
        <div className="mt-2 rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3">
          <div className="text-[12px] font-black text-textPrimary">
            Achievability: {labelCode(brief.achievabilityDirection.assessment)}
          </div>
          <p className="mt-1 text-[12.5px] text-textSecondary">
            {brief.achievabilityDirection.context}
          </p>
          <p className="mt-2 text-[12.5px] font-semibold text-textPrimary">
            {brief.achievabilityDirection.direction}
          </p>
        </div>
        <ul className="mt-2 grid gap-2">
          {brief.recommendationDirections.map((recommendation) => (
            <li
              key={`${recommendation.title}:${recommendation.reference.serviceId ?? recommendation.reference.serviceCategoryId}`}
              className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3"
            >
              <div className="text-[12.5px] font-black text-textPrimary">
                {recommendation.title}
              </div>
              <p className="mt-1 text-[12px] text-textSecondary">
                {recommendation.why}
              </p>
              <p className="mt-2 text-[12px] font-semibold text-textPrimary">
                {recommendation.direction}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {feedbackEnabled || brief.feedback ? (
        <div className="border-t border-surfaceGlass/10 pt-4">
          <ConsultBriefFeedbackButtons
            consultId={brief.consultId}
            initialFeedback={brief.feedback}
          />
        </div>
      ) : null}
    </article>
  )
}
