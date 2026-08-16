// app/pro/calendar/_components/ConfirmChangeModal.tsx
'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'

import type { PendingChange } from '../_types'
import { zClass } from '@/lib/zIndex'
import { DEFAULT_TIME_ZONE, formatInTimeZone, getViewerTimeZone } from '@/lib/time'
import {
  calendarModalButtonClassName,
  calendarModalTextareaClassName,
} from './modalControls'

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfirmChangeModalProps = {
  open: boolean
  change: PendingChange | null
  applying: boolean
  outsideWorkingHours?: boolean
  /** Passive double-book note: the client the new time overlaps, if any. */
  overlapName?: string | null
  overrideReason: string
  onChangeOverrideReason: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}

type ChangeSummary = {
  actionLabel: string
  nounLabel: string
  primaryLabel: string
  primaryValue: string
  confirmLabel: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_OVERRIDE_REASON_LENGTH = 280

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function formatLocalDateTime(iso: string, timeZone: string) {
  const date = new Date(iso)

  if (!Number.isFinite(date.getTime())) {
    return 'Time unavailable'
  }

  return formatInTimeZone(date, timeZone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Display a calendar change in the appointment's own timezone (a NY pro moving
 * an LA booking sees the new time in Pacific), not the viewer/server zone which
 * would render the wrong day. Blocks carry no appointment zone, so fall back to
 * the viewer's zone — matching the pro's calendar viewport.
 */
function changeDisplayTimeZone(change: PendingChange): string {
  if (change.original.kind === 'BOOKING' && change.original.timeZone) {
    return change.original.timeZone
  }

  return getViewerTimeZone() ?? DEFAULT_TIME_ZONE
}

function buildChangeSummary(args: {
  change: PendingChange
  outsideWorkingHours: boolean
}): ChangeSummary {
  const { change, outsideWorkingHours } = args
  const nounLabel = change.entityType === 'block' ? 'blocked time' : 'booking'

  if (change.kind === 'resize') {
    return {
      actionLabel: 'resize',
      nounLabel,
      primaryLabel: 'New duration',
      primaryValue: `${change.nextTotalDurationMinutes} min`,
      confirmLabel:
        outsideWorkingHours && change.entityType !== 'block'
          ? 'Save anyway'
          : 'Confirm resize',
    }
  }

  return {
    actionLabel: 'move',
    nounLabel,
    primaryLabel: 'New start time',
    primaryValue: formatLocalDateTime(
      change.nextStartIso,
      changeDisplayTimeZone(change),
    ),
    confirmLabel:
      outsideWorkingHours && change.entityType !== 'block'
        ? 'Save anyway'
        : 'Confirm move',
  }
}

function lockBodyScroll(open: boolean) {
  if (!open) return

  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  return () => {
    document.body.style.overflow = previousOverflow
  }
}

function closeOnEscape(args: {
  open: boolean
  applying: boolean
  onCancel: () => void
}) {
  const { open, applying, onCancel } = args

  if (!open) return

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !applying) {
      onCancel()
    }
  }

  window.addEventListener('keydown', onKeyDown)

  return () => window.removeEventListener('keydown', onKeyDown)
}

// ─── Exported component ───────────────────────────────────────────────────────

export function ConfirmChangeModal(props: ConfirmChangeModalProps) {
  const {
    open,
    change,
    applying,
    outsideWorkingHours = false,
    overlapName = null,
    overrideReason,
    onChangeOverrideReason,
    onCancel,
    onConfirm,
  } = props

  useEffect(() => lockBodyScroll(open), [open])

  useEffect(
    () =>
      closeOnEscape({
        open,
        applying,
        onCancel,
      }),
    [open, applying, onCancel],
  )

  if (!open || !change) return null

  const isBlock = change.entityType === 'block'
  const showOverrideReason = outsideWorkingHours && !isBlock

  const summary = buildChangeSummary({
    change,
    outsideWorkingHours,
  })

  const confirmDisabled = applying

  function cancel() {
    if (applying) return
    onCancel()
  }

  return (
    <div
      className={`fixed inset-0 ${zClass.modal} flex items-end justify-center bg-scrim/75 p-0 backdrop-blur-md sm:items-center sm:p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-change-title"
      onMouseDown={cancel}
    >
      <div
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-ink',
          'shadow-[0_28px_90px_rgb(var(--shadow-color)/0.62)]',
          'sm:max-w-[34rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-paper/20 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-terraGlow">
                ◆ Confirm calendar change
              </p>

              <h2
                id="confirm-change-title"
                className="mt-1 font-display text-3xl font-semibold italic tracking-[-0.05em] text-paper"
              >
                Confirm {summary.actionLabel}.
              </h2>

              <p className="mt-1 text-sm leading-6 text-paperDim">
                You&apos;re about to {summary.actionLabel} this{' '}
                {summary.nounLabel}.
              </p>
            </div>

            <button
              type="button"
              onClick={cancel}
              disabled={applying}
              className={calendarModalButtonClassName('ghost')}
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <section className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4">
            <InfoRow label={summary.primaryLabel}>
              {summary.primaryValue}
            </InfoRow>
          </section>

          {outsideWorkingHours && !isBlock ? (
            <section className="mt-4 rounded-2xl border border-toneWarn/25 bg-toneWarn/10 p-4">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-toneWarn">
                Outside working hours
              </p>

              <p className="mt-2 text-sm leading-6 text-paperDim">
                Clients cannot normally book this time. You can still place the
                booking here, and optionally add a note for your client.
              </p>
            </section>
          ) : null}

          {overlapName && !isBlock ? (
            <section className="mt-4 rounded-2xl border border-toneWarn/25 bg-toneWarn/10 p-4">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-toneWarn">
                Schedule conflict
              </p>

              <p className="mt-2 text-sm leading-6 text-paperDim">
                This overlaps {overlapName}. You can still move it.
              </p>
            </section>
          ) : null}

          {showOverrideReason ? (
            <section className="mt-4">
              <label htmlFor="calendar-override-reason">
                <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
                  Reason (optional — shared with your client)
                </span>

                <textarea
                  id="calendar-override-reason"
                  value={overrideReason}
                  onChange={(event) =>
                    onChangeOverrideReason(event.target.value)
                  }
                  rows={4}
                  maxLength={MAX_OVERRIDE_REASON_LENGTH}
                  placeholder="Explain why this booking needs to be scheduled outside working hours."
                  className={calendarModalTextareaClassName()}
                  disabled={applying}
                />
              </label>

              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] font-black uppercase tracking-[0.08em] text-paperMute">
                <span>Optional</span>
                <span>
                  {overrideReason.length}/{MAX_OVERRIDE_REASON_LENGTH}
                </span>
              </div>
            </section>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line-strong)] bg-ink/95 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancel}
              disabled={applying}
              className={calendarModalButtonClassName('ghost')}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={calendarModalButtonClassName('primary')}
            >
              {applying ? 'Applying…' : summary.confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow(props: {
  label: string
  children: ReactNode
}) {
  const { label, children } = props

  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink2 px-3 py-2">
      <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-paperMute">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-paper">
        {children}
      </p>
    </div>
  )
}