import type {
  ConsultProBriefDTO,
  ConsultServiceEstimateDTO,
} from '@/lib/dto/consult'
import { formatCents, formatMoneyFromUnknown, moneyToCentsInt } from '@/lib/money'
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

const PROFILE_LABELS: Record<
  keyof ConsultProBriefDTO['profile'],
  string
> = {
  skinUndertone: 'Skin undertone',
  contrastLevel: 'Natural contrast',
  colorSeason: 'Color season',
  faceProportion: 'Face proportion',
  jawline: 'Jawline',
  foreheadProportion: 'Forehead',
  featureBalance: 'Feature balance',
  eyeShape: 'Eye shape',
  eyeSpacing: 'Eye spacing',
  browDensity: 'Brow density',
  browShape: 'Brow shape',
}

const STYLE_DOMAIN_LABELS: Record<
  ConsultProBriefDTO['styleDirections'][number]['domain'],
  string
> = {
  HAIR_COLOR_HARMONY: 'Hair color',
  CUT_AND_SHAPE: 'Cut & shape',
  BANGS: 'Bangs',
  BROWS: 'Brows',
  LASHES: 'Lashes',
  MAKEUP: 'Makeup',
  COLOR_PALETTE: 'Color palette',
}

// ── Book the Look, B3: the line-item service estimate ────────────────────────
//
// PRO-FACING. Read-only here by design: adjust/flag is B5's, and a booking
// proposal is B4's. This slice only has to show her what her own menu says.

const ESTIMATE_REFUSAL_COPY: Record<
  NonNullable<ConsultServiceEstimateDTO['refusalCode']>,
  string
> = {
  LOOK_SERVICE_UNLINKED:
    'The look this consult started from no longer names a service, so there was nothing to price.',
  SERVICE_NOT_ON_MENU:
    'The service behind this look is not an active offering on your menu, so no price could come from your own list.',
  MENU_MODE_UNAVAILABLE:
    'That service is not offered in this mode on your menu.',
  MENU_PRICE_UNSET: 'That service has no price set on your menu for this mode.',
  MENU_DURATION_UNSET:
    'That service has no duration set on your menu for this mode.',
  PRO_SCHEDULING_NOT_READY:
    'There is no bookable location yet, so a duration could not be sized to your day.',
}

const ESTIMATE_SOURCE_LABELS: Record<
  ConsultServiceEstimateDTO['lines'][number]['source'],
  string
> = {
  LOOK_LINKED_SERVICE: 'From the look',
  ANALYSIS_RECOMMENDATION: 'From the analysis',
}

const ESTIMATE_MODE_LABELS: Record<
  ConsultServiceEstimateDTO['locationType'],
  string
> = {
  SALON: 'in-salon',
  MOBILE: 'mobile',
}

function ServiceEstimate({
  consultId,
  estimate,
}: {
  consultId: string
  estimate: ConsultServiceEstimateDTO
}) {
  // Summed in integer cents, never in floats: a displayed total is still money.
  const totalCents = estimate.lines.reduce<number | null>((total, line) => {
    if (total === null) return null
    const cents = moneyToCentsInt(line.estimatedPrice)
    return cents === null ? null : total + cents
  }, 0)
  const totalMinutes = estimate.lines.reduce(
    (total, line) => total + line.estimatedDurationMinutes,
    0,
  )

  return (
    <section aria-labelledby={`${consultId}-service-estimate`}>
      <h3
        id={`${consultId}-service-estimate`}
        className="text-[14px] font-black text-textPrimary"
      >
        Service estimate
      </h3>
      <p className="mt-1 text-[12px] text-textSecondary">
        Derived only from your own {ESTIMATE_MODE_LABELS[estimate.locationType]}{' '}
        prices and durations — nothing here is invented. Durations are rounded up
        to your slot length. You make the final call.
      </p>

      {estimate.status === 'REFUSED' ? (
        <p className="mt-2 rounded-xl border border-toneWarn/30 bg-toneWarn/10 p-3 text-[12.5px] text-textPrimary">
          No estimate:{' '}
          {estimate.refusalCode
            ? ESTIMATE_REFUSAL_COPY[estimate.refusalCode]
            : 'your menu cannot express this look.'}
        </p>
      ) : (
        <>
          <ul className="mt-2 grid gap-2">
            {estimate.lines.map((line) => (
              <li
                key={line.serviceId}
                className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3"
              >
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
                  {ESTIMATE_SOURCE_LABELS[line.source]}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[12.5px] font-black text-textPrimary">
                    {line.serviceName}
                  </span>
                  <span className="text-[12.5px] font-semibold text-textPrimary">
                    {formatMoneyFromUnknown(line.estimatedPrice)} ·{' '}
                    {line.estimatedDurationMinutes} min
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-textSecondary">
                  {line.rationale}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 border-t border-surfaceGlass/10 pt-2">
            <span className="text-[12px] font-bold uppercase tracking-wide text-textMuted">
              Estimated total
            </span>
            <span className="text-[13px] font-black text-textPrimary">
              {totalCents === null ? '—' : formatCents(totalCents)} ·{' '}
              {totalMinutes} min
              {estimate.bufferMinutes
                ? ` + ${estimate.bufferMinutes} min buffer`
                : ''}
            </span>
          </div>
        </>
      )}
    </section>
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

      <section aria-labelledby={`${brief.consultId}-profile`}>
        <h3
          id={`${brief.consultId}-profile`}
          className="text-[14px] font-black text-textPrimary"
        >
          Feature profile
        </h3>
        <p className="mt-1 text-[12px] text-textSecondary">
          Photo-based feature observations to confirm in person — color readings
          from phone photos are approximate; drape to verify.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            Object.entries(brief.profile) as Array<
              [
                keyof ConsultProBriefDTO['profile'],
                ConsultProBriefDTO['profile'][keyof ConsultProBriefDTO['profile']],
              ]
            >
          ).map(([field, observation]) => (
            <Observation
              key={field}
              label={PROFILE_LABELS[field]}
              value={observation.value}
              confidence={observation.confidence}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${brief.consultId}-style-directions`}>
        <h3
          id={`${brief.consultId}-style-directions`}
          className="text-[14px] font-black text-textPrimary"
        >
          Style directions by area
        </h3>
        <p className="mt-1 text-[12px] text-textSecondary">
          One feature-grounded direction per area — discussion starting points,
          not promises.
        </p>
        <ul className="mt-2 grid gap-2">
          {brief.styleDirections.map((direction) => (
            <li
              key={direction.domain}
              className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3"
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
                {STYLE_DOMAIN_LABELS[direction.domain]}
              </div>
              <div className="mt-1 text-[12.5px] font-black text-textPrimary">
                {direction.title}
              </div>
              <p className="mt-1 text-[12px] text-textSecondary">
                {direction.direction}
              </p>
              <p className="mt-2 text-[12px] font-semibold text-textPrimary">
                Why it flatters: {direction.whyItFlatters}
              </p>
            </li>
          ))}
        </ul>
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

      {brief.serviceEstimate ? (
        <ServiceEstimate
          consultId={brief.consultId}
          estimate={brief.serviceEstimate}
        />
      ) : null}

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
