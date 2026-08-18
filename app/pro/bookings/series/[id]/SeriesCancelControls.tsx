'use client'

// app/pro/bookings/series/[id]/SeriesCancelControls.tsx
//
// K19 (Phase 8) — the occurrence list and the two scoped cancels.
//
// The plan's third scope, *this one*, is the ordinary per-booking cancel: each
// row links to its own appointment, where the existing Cancel button already
// does exactly that. Reimplementing it here would be a second cancel path for
// one behaviour.
//
// 🔴 The confirmation is an in-page panel, not `window.confirm`. Two reasons,
// and both are load-bearing: a scoped cancel is not reversible and the pro is
// owed the actual list of dates it will take — a one-line browser dialog cannot
// carry "these 7 go, these 3 stay, and you are holding $80 that this does not
// refund" ([[authorized-override-needs-visibility]]) — and a `window.confirm`
// is auto-dismissed by headless browsers, so the most dangerous button on the
// page would be the one no drive could ever exercise
// ([[headless-dialog-autodismiss]]).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Badge } from '@/app/_components/ui'
import { classifySeriesOccurrenceCancel } from '@/lib/booking/series/cancelScope'
// B10: a booking status gets ONE word, from the canonical table — never a
// hand-rolled map on the screen that happens to need it.
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from '@/lib/booking/statusLabel'
import type {
  ProBookingSeriesCancelScope,
  ProBookingSeriesDetailDTO,
  ProBookingSeriesOccurrenceDetailDTO,
  ProBookingSeriesUntouchedReason,
} from '@/lib/dto/proBookingSeries'
import { errorFromResponse, safeJson } from '@/lib/http'
import {
  buildClientIdempotencyKey,
  idempotencyHeaders,
} from '@/lib/idempotency/client'
import { formatCents } from '@/lib/money'
import { formatDatedAppointmentWhen } from '@/lib/time'

const STATUS_COPY = {
  401: 'Please log in to continue.',
  404: 'That recurring appointment could not be found.',
}

type PendingScope = {
  scope: ProBookingSeriesCancelScope
  fromOccurrenceIndex: number | null
}

const UNTOUCHED_COPY: Record<ProBookingSeriesUntouchedReason, string> = {
  ALREADY_CANCELLED: 'Already cancelled',
  ALREADY_HAPPENED: 'Already happened',
  IN_PROGRESS: 'In progress',
  IN_PAST: 'In the past',
  OUT_OF_SCOPE: 'Earlier than this one',
}

/**
 * Reasons worth printing on an occurrence ROW. The other three restate the
 * status badge sitting next to them. (`OUT_OF_SCOPE` cannot reach a row — the
 * loader classifies at scope ALL — but it is listed because it is a scope fact,
 * not a status one, and would be worth showing if it ever did.)
 */
const REASON_NOT_IMPLIED_BY_STATUS: ReadonlySet<ProBookingSeriesUntouchedReason> =
  new Set(['IN_PAST', 'OUT_OF_SCOPE'])

export default function SeriesCancelControls({
  series,
}: {
  series: ProBookingSeriesDetailDTO
}) {
  const router = useRouter()

  const [pending, setPending] = useState<PendingScope | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The preview runs the SAME classifier the write boundary runs. It is a
  // preview, not the decision — the server re-classifies under the schedule
  // lock — but sharing the rule is what stops the panel promising something the
  // write then declines to do.
  const preview = useMemo(() => {
    if (!pending) return null

    const now = new Date()
    const willCancel: ProBookingSeriesOccurrenceDetailDTO[] = []
    const willKeep: Array<{
      occurrence: ProBookingSeriesOccurrenceDetailDTO
      reason: ProBookingSeriesUntouchedReason
    }> = []

    for (const occurrence of series.occurrences) {
      const verdict = classifySeriesOccurrenceCancel(
        {
          occurrenceIndex: occurrence.index,
          status: occurrence.status,
          startedAt: occurrence.startedAt
            ? new Date(occurrence.startedAt)
            : null,
          scheduledFor: new Date(occurrence.scheduledFor),
        },
        {
          scope: pending.scope,
          fromOccurrenceIndex: pending.fromOccurrenceIndex,
          now,
        },
      )

      if (verdict.cancellable) willCancel.push(occurrence)
      else willKeep.push({ occurrence, reason: verdict.reason })
    }

    return {
      willCancel,
      willKeep,
      depositHeldCents: willCancel.reduce(
        (sum, occurrence) => sum + occurrence.depositHeldCents,
        0,
      ),
    }
  }, [pending, series.occurrences])

  async function submit() {
    if (!pending || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const bodyJson = JSON.stringify({
        scope: pending.scope,
        fromOccurrenceIndex: pending.fromOccurrenceIndex,
      })

      const res = await fetch(
        `/api/v1/pro/booking-series/${encodeURIComponent(series.seriesId)}/cancel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...idempotencyHeaders(
              buildClientIdempotencyKey({
                scope: 'pro-booking-series-cancel',
                entityId: series.seriesId,
                action: 'cancel',
                nonce: bodyJson,
              }),
            ),
          },
          body: bodyJson,
        },
      )

      if (!res.ok) {
        setError(errorFromResponse(res, await safeJson(res), { byStatus: STATUS_COPY }))
        return
      }

      setPending(null)
      router.refresh()
    } catch (err) {
      console.error(err)
      setError('Network error cancelling these appointments. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const anyCancellable = series.occurrences.some(
    (occurrence) => occurrence.cancellable,
  )

  const rowButton =
    'rounded-xl border border-surfaceGlass/10 bg-bgPrimary px-3 py-2 text-[11px] font-black text-textSecondary transition hover:border-toneDanger/50 hover:text-textPrimary disabled:opacity-60'

  return (
    <section
      className="tovis-glass mt-3.5 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4"
      aria-labelledby="series-occurrences-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="series-occurrences-heading"
          className="font-mono text-[10px] font-bold uppercase tracking-widest text-textMuted"
        >
          Appointments
        </h2>

        {anyCancellable ? (
          <button
            type="button"
            className={rowButton}
            data-testid="series-cancel-all"
            onClick={() =>
              setPending({ scope: 'ALL', fromOccurrenceIndex: null })
            }
          >
            Cancel all remaining
          </button>
        ) : null}
      </div>

      <ul className="mt-3 grid gap-2">
        {series.occurrences.map((occurrence) => (
          <li
            key={occurrence.bookingId}
            className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3"
            data-testid={`series-occurrence-${occurrence.index}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-textMuted">
                    #{occurrence.index + 1}
                  </span>
                  <Link
                    href={`/pro/bookings/${encodeURIComponent(occurrence.bookingId)}`}
                    className="text-[13px] font-bold text-textPrimary underline-offset-2 hover:underline"
                  >
                    {formatDatedAppointmentWhen(
                      new Date(occurrence.scheduledFor),
                      series.timeZone,
                    )}
                  </Link>
                  <Badge tone={badgeToneForBookingStatus(occurrence.status)}>
                    {labelForBookingStatus(occurrence.status)}
                  </Badge>
                </div>
                <div className="mt-1 text-[12px] text-textSecondary">
                  {occurrence.bookedTotalCents != null
                    ? formatCents(occurrence.bookedTotalCents)
                    : 'Not priced'}
                  {occurrence.depositHeldCents > 0
                    ? ` · ${formatCents(occurrence.depositHeldCents)} deposit held`
                    : ''}
                  {/* Only the reasons the status badge does NOT already carry.
                      ALREADY_CANCELLED beside a "Cancelled" badge (and the same
                      for ALREADY_HAPPENED / IN_PROGRESS) says one thing twice;
                      IN_PAST is the only one that adds anything, because the row
                      still reads "Confirmed". */}
                  {!occurrence.cancellable &&
                  occurrence.untouchedReason &&
                  REASON_NOT_IMPLIED_BY_STATUS.has(occurrence.untouchedReason)
                    ? ` · ${UNTOUCHED_COPY[occurrence.untouchedReason]}`
                    : ''}
                </div>
              </div>

              {occurrence.cancellable ? (
                <button
                  type="button"
                  className={rowButton}
                  data-testid={`series-cancel-from-${occurrence.index}`}
                  onClick={() =>
                    setPending({
                      scope: 'THIS_AND_FUTURE',
                      fromOccurrenceIndex: occurrence.index,
                    })
                  }
                >
                  Cancel this and future
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pending && preview ? (
        <div
          className="mt-3.5 rounded-xl border border-toneDanger/35 bg-bgPrimary p-3.5"
          role="group"
          aria-label="Confirm cancelling these appointments"
          data-testid="series-cancel-confirm"
        >
          <p className="text-[13px] font-black text-textPrimary">
            {pending.scope === 'ALL'
              ? 'Cancel every remaining appointment in this series?'
              : 'Cancel this appointment and every one after it?'}
          </p>

          <p className="mt-1.5 text-[12px] text-textSecondary">
            This stops the recurring appointment. It cannot be undone — you would
            have to set it up again.
          </p>

          <p className="mt-2.5 text-[12px] font-bold text-textPrimary">
            {preview.willCancel.length} appointment
            {preview.willCancel.length === 1 ? '' : 's'} will be cancelled and
            the client notified.
          </p>

          {preview.willCancel.length > 0 ? (
            <ul className="mt-1.5 grid gap-1">
              {preview.willCancel.map((occurrence) => (
                <li
                  key={`will-cancel-${occurrence.bookingId}`}
                  className="text-[12px] text-textSecondary"
                >
                  {formatDatedAppointmentWhen(
                    new Date(occurrence.scheduledFor),
                    series.timeZone,
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Money the pro is holding. Cancelling does NOT refund it — pro
              cancellation is pro discretion — so the pro must read that here
              rather than discover it afterwards. */}
          {preview.depositHeldCents > 0 ? (
            <p className="mt-2.5 rounded-xl border border-toneWarn/35 bg-bgSecondary p-2.5 text-[12px] text-textSecondary">
              You are holding{' '}
              <span className="font-bold text-textPrimary">
                {formatCents(preview.depositHeldCents)}
              </span>{' '}
              in deposits across these appointments. Cancelling does not refund
              it — refund from each appointment if you mean to.
            </p>
          ) : null}

          {preview.willKeep.length > 0 ? (
            <div className="mt-2.5">
              <p className="text-[12px] font-bold text-textPrimary">
                {preview.willKeep.length} will be left alone:
              </p>
              <ul className="mt-1 grid gap-1" data-testid="series-cancel-keep">
                {preview.willKeep.map(({ occurrence, reason }) => (
                  <li
                    key={`will-keep-${occurrence.bookingId}`}
                    className="text-[12px] text-textSecondary"
                  >
                    {formatDatedAppointmentWhen(
                      new Date(occurrence.scheduledFor),
                      series.timeZone,
                    )}{' '}
                    — {UNTOUCHED_COPY[reason]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p className="mt-2.5 text-[12px] font-bold text-toneDanger">
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={submit}
              data-testid="series-cancel-confirm-submit"
              className="rounded-xl border border-toneDanger/50 bg-bgSecondary px-3 py-2 text-[12px] font-black text-toneDanger transition hover:border-toneDanger disabled:opacity-60"
            >
              {submitting ? 'Cancelling…' : 'Yes, cancel them'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                setPending(null)
                setError(null)
              }}
              className="rounded-xl border border-surfaceGlass/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textSecondary transition hover:text-textPrimary disabled:opacity-60"
            >
              Keep them
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
