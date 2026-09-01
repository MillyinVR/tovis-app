'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { Button, FieldLabel, TextInput, Textarea } from '@/app/_components/ui'
import { CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH } from '@/lib/consult/proProposalReviewLimits'
import type {
  ConsultProposalReviewDTO,
  ConsultProposalReviewLineDTO,
  ConsultProposalReviewLineStatusDTO,
} from '@/lib/dto/consult'
import { COPY } from '@/lib/copy'
import { normalizeMoney2 } from '@/lib/money'
import { formatInTimeZone } from '@/lib/time'

// Book the Look, B5 — the PRO's review of what a client committed to.
//
// 🔴 ONE SURFACE, TWO PLACEMENTS (direction doc, decision 4). The pro's
// `autoAcceptBookings` toggle decides only WHERE the page renders this — above
// the accept/decline she already has, or below a booking it already accepted —
// and the server answers that as `placement`. Everything this component says is
// the same in both, except the single sentence in PLACEMENT_NOTE below, which
// exists so that both readings sit side by side in ONE place and cannot drift
// into two components.
//
// 🔴 Nothing here reaches the client. Recording a correction changes no booking
// field, moves no slot and sends no notification: the revision-notice threshold
// (how far a pro may move a price before the client is told and offered a
// cancel/refund) is still Tori's open decision. The surface says so out loud
// rather than letting a pro assume her client has been told.

const PLACEMENT_NOTE: Record<ConsultProposalReviewDTO['placement'], string> = {
  BEFORE_DECISION: COPY.consultProposalReview.placementBeforeDecision,
  AFTER_ACCEPTANCE: COPY.consultProposalReview.placementAfterAcceptance,
}

const STATUS_LABEL: Record<ConsultProposalReviewLineStatusDTO, string> = {
  NOT_REVIEWED: 'Not reviewed',
  CONFIRMED: 'Confirmed',
  ADJUSTED: 'Adjusted',
  FLAGGED: 'Flagged',
}

const STATUS_TONE: Record<ConsultProposalReviewLineStatusDTO, string> = {
  NOT_REVIEWED: 'border-surfaceGlass/15 bg-surfaceGlass/5 text-textMuted',
  CONFIRMED: 'border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess',
  ADJUSTED: 'border-toneInfo/30 bg-toneInfo/10 text-toneInfo',
  FLAGGED: 'border-toneWarn/30 bg-toneWarn/10 text-toneWarn',
}

const SOURCE_LABEL: Record<ConsultProposalReviewLineDTO['source'], string> = {
  LOOK_LINKED_SERVICE: 'From the look',
  ANALYSIS_RECOMMENDATION: 'From the analysis',
}

const MODE_LABEL: Record<ConsultProposalReviewDTO['locationType'], string> = {
  SALON: 'In-salon',
  MOBILE: 'Mobile',
}

type LineDraft = { price: string; durationMinutes: string; note: string }

function toDraft(line: ConsultProposalReviewLineDTO): LineDraft {
  // Seeded from her own recorded numbers once she has recorded some, and from
  // what the client was sold before that — never from the estimate's salon
  // figure, which is a different mode's answer to a different question.
  return {
    price: line.proFinalPrice ?? line.proposedPrice,
    durationMinutes: String(
      line.proFinalDurationMinutes ?? line.proposedDurationMinutes,
    ),
    note: line.proFinalNote ?? '',
  }
}

function buildDrafts(
  review: ConsultProposalReviewDTO,
): Record<string, LineDraft> {
  const drafts: Record<string, LineDraft> = {}
  for (const line of review.lines) drafts[line.estimateLineId] = toDraft(line)
  return drafts
}

function parseDurationMinutes(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const minutes = Number.parseInt(trimmed, 10)
  return minutes > 0 ? minutes : null
}

function StatusPill({
  status,
}: {
  status: ConsultProposalReviewLineStatusDTO
}) {
  return (
    <span
      data-testid={`proposal-review-status-${status}`}
      className={[
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]',
        STATUS_TONE[status],
      ].join(' ')}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export default function ProConsultProposalReview({
  review: initialReview,
  timeZone,
}: {
  review: ConsultProposalReviewDTO
  timeZone: string
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 🔴 The server is the ONLY source of the statuses and the totals below. This
  // component holds nothing but the pro's in-progress edits: on a successful
  // save it re-runs the page, and the section re-renders from the loader's own
  // answer. A locally-maintained copy of the review is a second opinion about
  // money, and the two would drift the first time a write partially applied.
  const review = initialReview
  const [drafts, setDrafts] = useState(() => buildDrafts(initialReview))
  const [seed, setSeed] = useState(initialReview)
  if (seed !== initialReview) {
    // React's documented "adjust state when a prop changes" pattern: the server
    // just re-rendered, so the drafts re-seed from what it now says is stored.
    setSeed(initialReview)
    setDrafts(buildDrafts(initialReview))
  }

  const invalid = useMemo(
    () =>
      review.lines.some((line) => {
        const draft = drafts[line.estimateLineId]
        if (!draft) return true
        return (
          normalizeMoney2(draft.price) === null ||
          parseDurationMinutes(draft.durationMinutes) === null ||
          draft.note.trim().length > CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH
        )
      }),
    [drafts, review.lines],
  )

  function setField(id: string, field: keyof LineDraft, value: string) {
    setDrafts((current) => {
      const draft = current[id]
      if (!draft) return current
      return { ...current, [id]: { ...draft, [field]: value } }
    })
    setSaved(false)
  }

  async function save() {
    if (saving || refreshing || invalid) return
    setSaving(true)
    setError(null)
    try {
      const lines = review.lines.map((line) => {
        const draft = drafts[line.estimateLineId] ?? toDraft(line)
        return {
          estimateLineId: line.estimateLineId,
          // Sent as the money STRING the wire expects — the server re-validates
          // and re-normalizes it; this is an echo of what she typed, not a
          // price the browser derived.
          price: normalizeMoney2(draft.price) ?? draft.price,
          durationMinutes: parseDurationMinutes(draft.durationMinutes) ?? 0,
          note: draft.note.trim() ? draft.note.trim() : null,
        }
      })

      const response = await fetch(
        `/api/v1/pro/bookings/${encodeURIComponent(review.bookingId)}/consult-proposal`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lines }),
        },
      )
      const payload: unknown = await response.json().catch(() => null)
      if (
        !response.ok ||
        !payload ||
        typeof payload !== 'object' ||
        !('review' in payload)
      ) {
        throw new Error('review unavailable')
      }
      // The response body is not read for display — only to know the write
      // landed. Re-running the page is what refreshes the statuses and totals,
      // from the same loader the first render used.
      setSaved(true)
      startRefresh(() => router.refresh())
    } catch {
      setError('Your notes could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      data-testid="consult-proposal-review"
      data-placement={review.placement}
      className="tovis-glass mb-3.5 rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4"
    >
      <h2 className="font-display text-[14px] font-bold text-textPrimary">
        {COPY.consultProposalReview.title}
      </h2>
      <p className="mt-1 text-[12px] text-textMuted">
        {PLACEMENT_NOTE[review.placement]}
      </p>

      {/* WHAT SHE AGREED TO — echoed from the stored proposal, never re-derived. */}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3">
        <div className="text-[12px] font-semibold text-textSecondary">
          {MODE_LABEL[review.locationType]} · {review.totalDurationMinutes} min
          set aside
          {review.bufferMinutes
            ? ` + ${review.bufferMinutes} min buffer`
            : ''}
        </div>
        {review.startingAtLabel ? (
          <div className="text-[13px] font-black text-textPrimary">
            {review.startingAtLabel}
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11.5px] text-textMuted">
        {COPY.consultProposalReview.agreedNote}
      </p>

      <ul className="mt-3 grid gap-2">
        {review.lines.map((line) => {
          const draft = drafts[line.estimateLineId] ?? toDraft(line)
          const priceInvalid = normalizeMoney2(draft.price) === null
          const durationInvalid =
            parseDurationMinutes(draft.durationMinutes) === null
          return (
            <li
              key={line.estimateLineId}
              data-testid={`proposal-review-line-${line.serviceId}`}
              className="rounded-xl border border-surfaceGlass/10 bg-bgPrimary p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-microAccent">
                  {SOURCE_LABEL[line.source]}
                </div>
                <StatusPill status={line.reviewStatus} />
              </div>

              <div className="mt-1 text-[12.5px] font-black text-textPrimary">
                {line.serviceName}
              </div>
              {line.rationale ? (
                <p className="mt-1 text-[12px] text-textSecondary">
                  {line.rationale}
                </p>
              ) : null}
              <p className="mt-1.5 text-[12px] font-semibold text-textPrimary">
                She was quoted ${line.proposedPrice} ·{' '}
                {line.proposedDurationMinutes} min
              </p>

              {review.editable ? (
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <FieldLabel as="span">Your price ($)</FieldLabel>
                    <TextInput
                      surface="raised"
                      inputMode="decimal"
                      value={draft.price}
                      aria-invalid={priceInvalid || undefined}
                      data-testid={`proposal-review-price-${line.serviceId}`}
                      onChange={(event) =>
                        setField(
                          line.estimateLineId,
                          'price',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1">
                    <FieldLabel as="span">Your time (min)</FieldLabel>
                    <TextInput
                      surface="raised"
                      inputMode="numeric"
                      value={draft.durationMinutes}
                      aria-invalid={durationInvalid || undefined}
                      data-testid={`proposal-review-duration-${line.serviceId}`}
                      onChange={(event) =>
                        setField(
                          line.estimateLineId,
                          'durationMinutes',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label className="grid gap-1 sm:col-span-2">
                    <FieldLabel as="span">
                      Flag something about this line (optional)
                    </FieldLabel>
                    <Textarea
                      surface="raised"
                      rows={2}
                      maxLength={CONSULT_PROPOSAL_REVIEW_NOTE_MAX_LENGTH}
                      value={draft.note}
                      placeholder="What you would want to say to her in person."
                      data-testid={`proposal-review-note-${line.serviceId}`}
                      onChange={(event) =>
                        setField(line.estimateLineId, 'note', event.target.value)
                      }
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-2 text-[12px] text-textSecondary">
                  {line.proFinalAt ? (
                    <>
                      You recorded ${line.proFinalPrice} ·{' '}
                      {line.proFinalDurationMinutes} min
                      {line.proFinalNote ? ` — ${line.proFinalNote}` : ''}
                    </>
                  ) : (
                    'You did not record anything for this line.'
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {review.proFinalTotalPrice && review.proFinalTotalDurationMinutes ? (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 border-t border-surfaceGlass/10 pt-2">
          <span className="text-[12px] font-bold uppercase tracking-wide text-textMuted">
            Your total
          </span>
          <span
            data-testid="proposal-review-pro-total"
            className="text-[13px] font-black text-textPrimary"
          >
            ${review.proFinalTotalPrice} ·{' '}
            {review.proFinalTotalDurationMinutes} min
          </span>
        </div>
      ) : null}

      {review.editable ? (
        <div className="mt-3 grid gap-2 border-t border-surfaceGlass/10 pt-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              size="sm"
              disabled={saving || refreshing || invalid}
              data-testid="proposal-review-save"
              onClick={() => void save()}
            >
              {saving || refreshing ? 'Saving…' : 'Save my numbers'}
            </Button>
            {review.reviewedAt ? (
              <span className="text-[11.5px] text-textMuted">
                Last recorded{' '}
                {formatInTimeZone(new Date(review.reviewedAt), timeZone, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            ) : null}
          </div>
          {invalid ? (
            <p className="text-[12px] font-semibold text-toneWarn">
              Every line needs a price of $0 or more and a whole number of
              minutes above zero.
            </p>
          ) : null}
          {error ? (
            <p className="text-[12px] font-semibold text-toneDanger">{error}</p>
          ) : null}
          {saved && !refreshing ? (
            <p
              data-testid="proposal-review-saved"
              className="text-[12px] font-semibold text-toneSuccess"
            >
              {COPY.consultProposalReview.savedNote}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 border-t border-surfaceGlass/10 pt-3 text-[12px] text-textMuted">
          {COPY.consultProposalReview.closedNote}
        </p>
      )}
    </section>
  )
}
