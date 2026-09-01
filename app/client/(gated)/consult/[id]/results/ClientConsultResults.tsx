import Link from 'next/link'

import ClientPage from '../../../_components/ClientPage'

import type { BrandClientConsultResultsCopy } from '@/lib/brand/types'
import type {
  ConsultAnalysisConfidenceDTO,
  ConsultClientResultsDTO,
} from '@/lib/dto/consult'

import LockedMeCardTeaser from './LockedMeCardTeaser'

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
  copy,
}: {
  label: string
  value: string
  confidence: ConsultAnalysisConfidenceDTO
  copy: BrandClientConsultResultsCopy
}) {
  return (
    <li className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-textMuted">
        {label}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-textPrimary">
        {labelCode(value)}{' '}
        <span className="font-normal text-textMuted">
          · {Math.round(confidence.min * 100)}–{Math.round(confidence.max * 100)}%{' '}
          {copy.confidenceSuffix}
        </span>
      </div>
    </li>
  )
}

export default function ClientConsultResults({
  results,
  copy,
}: {
  results: ConsultClientResultsDTO
  copy: BrandClientConsultResultsCopy
}) {
  const observations = results.aiObservations
  const level = observations.currentLevel
  const levelValue =
    level.min == null || level.max == null
      ? copy.unknownLabel
      : `${copy.levelPrefix} ${level.min}–${level.max}`

  // A consult is anchored to a booking or, since Book the Look, to a look —
  // and ClientPage without a `back` leaves the client's only exit as a tab, so
  // each anchor names its own way out.
  const backLink = results.bookingId
    ? {
        href: `/client/bookings/${encodeURIComponent(results.bookingId)}`,
        label: copy.backToBooking,
      }
    : results.lookPostId
      ? {
          href: `/looks/${encodeURIComponent(results.lookPostId)}`,
          label: copy.backToLook,
        }
      : undefined

  return (
    <ClientPage
      eyebrow={copy.eyebrow}
      title={copy.title}
      lede={copy.intro}
      back={backLink}
      width="wide"
    >
      <div className="grid gap-6">
      <section
        aria-labelledby={`${results.consultId}-client-words`}
        className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
      >
        <h2
          id={`${results.consultId}-client-words`}
          className="text-base font-black text-textPrimary"
        >
          {copy.clientWordsTitle}
        </h2>
        <dl className="mt-3 grid gap-3">
          {results.clientIntake.map((item) => (
            <div key={item.questionKey} className="grid gap-0.5">
              <dt className="text-xs font-semibold text-textMuted">
                {item.question}
              </dt>
              <dd className="text-sm font-bold text-textPrimary">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby={`${results.consultId}-observations`}
        className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
      >
        <h2
          id={`${results.consultId}-observations`}
          className="text-base font-black text-textPrimary"
        >
          {copy.aiObservationsTitle}
        </h2>
        <p className="mt-1 text-sm text-textSecondary">
          {copy.aiObservationsBody}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <li className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wide text-textMuted">
              {copy.currentLevelLabel}
            </div>
            <div className="mt-1 text-[13px] font-semibold text-textPrimary">
              {levelValue}{' '}
              <span className="font-normal text-textMuted">
                · {Math.round(level.confidence.min * 100)}–
                {Math.round(level.confidence.max * 100)}% {copy.confidenceSuffix}
              </span>
            </div>
          </li>
          <Observation
            label={copy.toneLabel}
            value={observations.currentTone.value}
            confidence={observations.currentTone.confidence}
            copy={copy}
          />
          <Observation
            label={copy.conditionLabel}
            value={observations.visibleCondition.value}
            confidence={observations.visibleCondition.confidence}
            copy={copy}
          />
          <Observation
            label={copy.densityLabel}
            value={observations.density.value}
            confidence={observations.density.confidence}
            copy={copy}
          />
          <Observation
            label={copy.textureLabel}
            value={observations.texture.value}
            confidence={observations.texture.confidence}
            copy={copy}
          />
        </ul>
      </section>

      <section
        aria-labelledby={`${results.consultId}-profile`}
        className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
      >
        <h2
          id={`${results.consultId}-profile`}
          className="text-base font-black text-textPrimary"
        >
          {copy.profileTitle}
        </h2>
        <p className="mt-1 text-sm text-textSecondary">{copy.profileBody}</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            Object.entries(results.profile) as Array<
              [
                keyof typeof results.profile,
                (typeof results.profile)[keyof typeof results.profile],
              ]
            >
          ).map(([field, observation]) => (
            <Observation
              key={field}
              label={copy.profileLabels[field]}
              value={observation.value}
              confidence={observation.confidence}
              copy={copy}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${results.consultId}-style-directions`}>
        <h2
          id={`${results.consultId}-style-directions`}
          className="text-lg font-black text-textPrimary"
        >
          {copy.styleDirectionsTitle}
        </h2>
        <p className="mt-1 text-sm text-textSecondary">
          {copy.styleDirectionsBody}
        </p>
        <ul className="mt-3 grid gap-3">
          {results.styleDirections.map((direction) => (
            <li
              key={direction.domain}
              className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
                {copy.styleDomainLabels[direction.domain]}
              </div>
              <h3 className="mt-2 text-base font-black text-textPrimary">
                {direction.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-textSecondary">
                {direction.direction}
              </p>
              <p className="mt-3 text-sm leading-6 text-textPrimary">
                <span className="font-black">{copy.whyItFlattersLabel}:</span>{' '}
                {direction.whyItFlatters}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby={`${results.consultId}-safety`}
        className="rounded-2xl border border-toneWarn/30 bg-toneWarn/10 p-5"
        data-safety-visible="true"
      >
        <h2
          id={`${results.consultId}-safety`}
          className="text-base font-black text-textPrimary"
        >
          {copy.safetyTitle}
        </h2>
        {results.safetyFlags.length ? (
          <ul className="mt-3 grid gap-2">
            {results.safetyFlags.map((flag) => (
              <li key={flag.code} className="text-sm leading-6 text-textPrimary">
                <span className="font-black">{labelCode(flag.code)}:</span>{' '}
                {flag.summary} {copy.safetyItemSuffix}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-6 text-textSecondary">
            {copy.safetyEmpty}
          </p>
        )}
      </section>

      <section
        aria-labelledby={`${results.consultId}-achievability`}
        className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
      >
        <h2
          id={`${results.consultId}-achievability`}
          className="text-base font-black text-textPrimary"
        >
          {copy.achievabilityTitle}
        </h2>
        <div className="mt-3 text-sm font-black text-textPrimary">
          {
            copy.achievabilityLabels[
              results.achievabilityDirection.assessment
            ]
          }
        </div>
        <p className="mt-2 text-sm leading-6 text-textSecondary">
          {results.achievabilityDirection.context}
        </p>
        <p className="mt-2 text-sm font-bold leading-6 text-textPrimary">
          {results.achievabilityDirection.direction}
        </p>
      </section>

      <section aria-labelledby={`${results.consultId}-directions`}>
        <h2
          id={`${results.consultId}-directions`}
          className="text-lg font-black text-textPrimary"
        >
          {copy.recommendationsTitle}
        </h2>
        <ol className="mt-3 grid gap-3">
          {results.recommendationDirections.map((recommendation, index) => (
            <li
              key={`${recommendation.title}:${recommendation.reference.serviceId ?? recommendation.reference.serviceCategoryId}`}
              className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
            >
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
                {index + 1} / {results.recommendationDirections.length}
              </div>
              <h3 className="mt-2 text-base font-black text-textPrimary">
                {recommendation.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-textSecondary">
                {recommendation.why}
              </p>
              <p className="mt-3 text-sm font-bold leading-6 text-textPrimary">
                {copy.recommendationDiscussionPrefix}{' '}
                {recommendation.title}.
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Book the Look, B4b — the door from a finished consult to a booking.
          Rendered only for a LOOK-anchored consult: a booking-anchored one
          (#1016) already HAS its booking, and offering to book it again would
          be nonsense. Whether a proposal can actually be made is the booking
          page's own answer — every refusal there is explained rather than
          hidden behind a missing button, so this never has to guess. */}
      {results.lookPostId ? (
        <section
          data-testid="consult-results-book-look"
          aria-labelledby={`${results.consultId}-book-look`}
          className="rounded-2xl border border-surfaceGlass/10 bg-bgSurface p-5"
        >
          <h2
            id={`${results.consultId}-book-look`}
            className="text-base font-black text-textPrimary"
          >
            {copy.bookLookTitle}
          </h2>
          <p className="mt-1 text-sm leading-6 text-textSecondary">
            {copy.bookLookBody}
          </p>
          <Link
            href={`/client/consult/${encodeURIComponent(results.consultId)}/book`}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-full border border-surfaceGlass/10 bg-accentPrimary text-[14px] font-black text-bgPrimary hover:bg-accentPrimaryHover"
          >
            {copy.bookLookCta}
          </Link>
        </section>
      ) : null}

      <LockedMeCardTeaser
        consultId={results.consultId}
        copy={copy}
        initiallyTapped={results.meCardTeaser.tapped}
      />
      </div>
    </ClientPage>
  )
}
