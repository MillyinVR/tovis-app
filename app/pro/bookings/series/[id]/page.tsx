// app/pro/bookings/series/[id]/page.tsx
//
// K19 (Phase 8) — the pro's view of a standing appointment.
//
// 🔴 THE reason this page exists: K18's create route can return a 201 carrying
// eleven bookings and one skip, and until now nothing rendered the skip. A pro
// who asked for twelve fortnightly appointments and got eleven had no surface
// that would ever tell them ([[an-always-empty-key-looks-like-an-export]]). The
// count line and the "couldn't be booked" block below are the whole point of
// the step; the occurrence list is the easy half.
//
// Not gated on `recurringAppointmentsEnabled()` — the CREATE control is (see
// NewBookingForm), but a series that already exists must stay visible and
// stoppable after the switch goes off. Data gates it: no series, no page.
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Role } from '@prisma/client'

import { Badge } from '@/app/_components/ui'
import { loadProBookingSeriesDetail } from '@/lib/booking/series/detail'
import { getCurrentUser } from '@/lib/currentUser'
import type {
  ProBookingSeriesDetailDTO,
  ProBookingSeriesSkippedOccurrenceDTO,
} from '@/lib/dto/proBookingSeries'
import { formatCents } from '@/lib/money'
import { formatDatedAppointmentWhen, friendlyTimeZoneLabel } from '@/lib/time'
import ClientProfileLink from '@/app/_components/ClientProfileLink'
import { clientPublicProfileHref } from '@/lib/profiles/profileHrefs'

import SeriesCancelControls from './SeriesCancelControls'

export const dynamic = 'force-dynamic'

function cadenceLabel(intervalWeeks: number): string {
  if (intervalWeeks === 1) return 'Every week'
  if (intervalWeeks === 2) return 'Every 2 weeks'
  return `Every ${intervalWeeks} weeks`
}

function seriesStatusTone(
  status: ProBookingSeriesDetailDTO['status'],
): 'success' | 'neutral' | 'danger' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'CANCELLED') return 'danger'
  return 'neutral'
}

function seriesStatusLabel(
  status: ProBookingSeriesDetailDTO['status'],
): string {
  if (status === 'ACTIVE') return 'Active'
  if (status === 'CANCELLED') return 'Stopped'
  return 'Finished'
}

/**
 * Plain words for a skip. The DTO carries the machine reason plus a `detail`
 * that is a BookingErrorCode or an impossible wall clock — diagnostic, never
 * shown as the sentence. The pro is told what happened; the code sits beside it
 * for when they ask us why.
 */
function skipCopy(skip: ProBookingSeriesSkippedOccurrenceDTO): string {
  if (skip.reason === 'NONEXISTENT_LOCAL_TIME') {
    return 'That clock time does not exist on this date — the clocks go forward. Book this one by hand at a time that does.'
  }
  if (skip.reason === 'SLOT_UNAVAILABLE') {
    return 'That time was already taken, so this date was left alone rather than double-booked.'
  }
  return 'This date could not be booked.'
}

export default async function ProBookingSeriesPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const seriesId = typeof params.id === 'string' ? params.id.trim() : ''

  const user = await getCurrentUser()

  if (!user || user.role !== Role.PRO || !user.professionalProfile?.id) {
    redirect('/login?from=/pro/bookings')
  }

  if (!seriesId) notFound()

  const series = await loadProBookingSeriesDetail({
    professionalId: user.professionalProfile.id,
    seriesId,
  })

  if (!series) notFound()

  const tzLabel = friendlyTimeZoneLabel(series.timeZone)
  const bookedCount = series.occurrences.length
  const skippedCount = series.skipped.length
  const attempted = bookedCount + skippedCount
  const plannedLabel =
    series.occurrenceCount != null
      ? `${series.occurrenceCount} planned`
      : 'Open-ended'

  return (
    <main className="mx-auto w-full max-w-240 px-4 pb-24 pt-8">
      <Link
        href="/pro/bookings"
        className="inline-flex items-center gap-1.5 text-textMuted transition hover:text-textSecondary"
      >
        <span aria-hidden>←</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest">
          Bookings
        </span>
      </Link>

      <div className="mt-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary">
            Studio · Recurring appointment
          </div>
          <h1 className="mt-1.5 font-display text-[28px] font-bold tracking-tight text-textPrimary">
            {/* The client's public profile when they have one; plain text
                otherwise. This page is the pro's own record of the series, so
                there is no chart arm — the chart has its own entry points. */}
            <ClientProfileLink
              href={clientPublicProfileHref({
                handle: series.clientPublicProfileHandle,
                isPublicProfile: series.clientPublicProfileHandle != null,
              })}
              label={series.clientName}
            />
          </h1>
          <p className="mt-1.5 text-[13px] text-textSecondary">
            {series.serviceName} · {cadenceLabel(series.intervalWeeks)} ·{' '}
            {plannedLabel}
          </p>
          <p className="mt-1 text-[12px] text-textMuted">
            {series.locationLabel} · times shown in {tzLabel}
          </p>
          {series.addOnNames.length > 0 ? (
            <p className="mt-1 text-[12px] text-textMuted">
              Add-ons: {series.addOnNames.join(', ')}
            </p>
          ) : null}
        </div>

        <Badge tone={seriesStatusTone(series.status)}>
          {seriesStatusLabel(series.status)}
        </Badge>
      </div>

      {/* The honest headline. `attempted` — not the planned count — is what the
          materializer actually tried, so an open-ended series that stopped at
          the horizon does not read as a failure. */}
      <section
        className="tovis-glass mt-5 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4"
        aria-labelledby="series-outcome-heading"
      >
        <h2
          id="series-outcome-heading"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-textMuted"
        >
          What was booked
        </h2>
        <p className="mt-1.5 text-[15px] font-black text-textPrimary">
          {bookedCount} of {attempted} dates booked
          {skippedCount > 0 ? (
            <span className="text-toneWarn">
              {' '}
              · {skippedCount} could not be booked
            </span>
          ) : null}
        </p>

        {skippedCount > 0 ? (
          <ul className="mt-3 grid gap-2" data-testid="series-skipped-list">
            {series.skipped.map((skip) => (
              <li
                key={`skip-${skip.index}`}
                className="rounded-xl border border-toneWarn/35 bg-bgPrimary p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warn">Not booked</Badge>
                  <span className="text-[13px] font-bold text-textPrimary">
                    {skip.intendedStart
                      ? formatDatedAppointmentWhen(
                          new Date(skip.intendedStart),
                          series.timeZone,
                        )
                      : (skip.detail ?? 'Date unavailable')}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] text-textSecondary">
                  {skipCopy(skip)}
                </p>
                {skip.detail && skip.reason !== 'NONEXISTENT_LOCAL_TIME' ? (
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">
                    {skip.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* K20 — the roll-forward, stated. Until this step a series simply
            stopped at the horizon, so "12 of 12 booked" was the whole truth;
            now a longer or open-ended run has dates nobody has been shown yet,
            and the pro is owed the fact that something will create them. The
            flag state is baked into `willContinue`, so this cannot promise an
            operator that is switched off. */}
        {series.rollForward.willContinue ? (
          <p
            className="mt-3 rounded-xl border border-toneInfo/35 bg-bgPrimary p-3 text-[12px] text-textSecondary"
            data-testid="series-roll-forward"
          >
            {series.rollForward.pendingCount == null
              ? 'This series is open-ended. '
              : `${series.rollForward.pendingCount} more ${
                  series.rollForward.pendingCount === 1
                    ? 'appointment is'
                    : 'appointments are'
                } still to come. `}
            Dates are added to your calendar automatically, about{' '}
            {series.rollForward.leadDays} days ahead — you do not need to do
            anything.
          </p>
        ) : null}
      </section>

      {/* Price pinning (plan §Phase 8): what the client agreed to, and whether
          anything has moved since. Surfaced, never applied — repricing a
          standing client is a decision, not a side effect. */}
      <section
        className="tovis-glass mt-3.5 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4"
        aria-labelledby="series-price-heading"
      >
        <h2
          id="series-price-heading"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-textMuted"
        >
          Price
        </h2>
        <p className="mt-1.5 text-[15px] font-black text-textPrimary">
          {series.pricing.pinnedTotalCents != null
            ? `${formatCents(series.pricing.pinnedTotalCents)} per appointment`
            : 'Not priced'}
        </p>
        <p className="mt-1 text-[12px] text-textSecondary">
          Every appointment in this series is booked at the price the client
          agreed to when it was set up
          {series.rollForward.willContinue
            ? ', including the dates still to be added'
            : ''}
          .
        </p>

        {/* K20 settled the question K19 left open: the pin wins, so a moved list
            price is a gap the pro can act on, never a prediction of the next
            bill. The copy has to say which number the client is charged — the
            whole point of the decision is that nothing is repriced quietly. */}
        {series.pricing.listPriceMoved &&
        series.pricing.currentListTotalCents != null ? (
          <p className="mt-2.5 rounded-xl border border-toneInfo/35 bg-bgPrimary p-3 text-[12px] text-textSecondary">
            Your current list price for this service is{' '}
            <span className="font-bold text-textPrimary">
              {formatCents(series.pricing.currentListTotalCents)}
            </span>
            . These appointments keep their agreed price — nothing has been
            repriced
            {series.rollForward.willContinue
              ? ', and new dates will be booked at the agreed price too. To move this client to your current price, end this series and start a new one'
              : ''}
            .
          </p>
        ) : null}

        {series.pricing.occurrencesDisagree ? (
          <p className="mt-2.5 rounded-xl border border-toneWarn/35 bg-bgPrimary p-3 text-[12px] text-textSecondary">
            Some appointments in this series were booked at a different price to
            the first one. The per-appointment prices are listed below.
          </p>
        ) : null}
      </section>

      <SeriesCancelControls series={series} />
    </main>
  )
}
