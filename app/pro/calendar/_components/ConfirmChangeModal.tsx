// app/pro/calendar/_components/ConfirmChangeModal.tsx
'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'

import type { PendingChange } from '../_types'

type ConfirmChangeModalProps = {
  open: boolean
  change: PendingChange | null
  applying: boolean
  outsideWorkingHours?: boolean
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

const MAX_OVERRIDE_REASON_LENGTH = 280

function formatLocalDateTime(iso: string) {
  const date = new Date(iso)

  if (!Number.isFinite(date.getTime())) {
    return 'Time unavailable'
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildChangeSummary(args: {
  change: PendingChange
  outsideWorkingHours: boolean
}): ChangeSummary {
  const { change, outsideWorkingHours } = args
  const nounLabel = change.entityType === 'block' ? 'blocked time' : 'appointment'

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
    primaryValue: formatLocalDateTime(change.nextStartIso),
    confirmLabel:
      outsideWorkingHours && change.entityType !== 'block'
        ? 'Save anyway'
        : 'Confirm move',
  }
}

function buttonClassName(tone: 'primary' | 'ghost' = 'ghost') {
  const base = [
    'rounded-full px-4 py-2 font-mono text-[11px] font-black uppercase tracking-[0.08em]',
    'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')

  if (tone === 'primary') {
    return [
      base,
      'border border-accentPrimary/30 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
    ].join(' ')
  }

  return [
    base,
    'border border-[var(--line)] bg-transparent text-[var(--paper-mute)] hover:bg-[var(--paper)]/[0.05] hover:text-[var(--paper)]',
  ].join(' ')
}

function textareaClassName() {
  return [
    'w-full resize-none rounded-2xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2',
    'text-sm font-semibold text-[var(--paper)] placeholder:text-[var(--paper-mute)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ].join(' ')
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

export function ConfirmChangeModal(props: ConfirmChangeModalProps) {
  const {
    open,
    change,
    applying,
    outsideWorkingHours = false,
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
  const needsOverrideReason = outsideWorkingHours && !isBlock
  const trimmedOverrideReason = overrideReason.trim()

  const summary = buildChangeSummary({
    change,
    outsideWorkingHours,
  })

  const confirmDisabled =
    applying || (needsOverrideReason && trimmedOverrideReason.length === 0)

  function cancel() {
    if (applying) return
    onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-change-title"
      onMouseDown={cancel}
    >
      <div
        className={[
          'flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-[24px]',
          'border border-[var(--line-strong)] bg-[var(--ink)]',
          'shadow-[0_28px_90px_rgb(0_0_0/0.62)]',
          'sm:max-w-[34rem] sm:rounded-[24px]',
        ].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[var(--line-strong)] bg-[var(--ink)]/92 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[var(--paper)]/20 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--terra-glow)]">
                ◆ Confirm calendar change
              </p>

              <h2
                id="confirm-change-title"
                className="mt-1 font-display text-3xl font-semibold italic tracking-[-0.05em] text-[var(--paper)]"
              >
                Confirm {summary.actionLabel}.
              </h2>

              <p className="mt-1 text-sm leading-6 text-[var(--paper-dim)]">
                You’re about to {summary.actionLabel} this {summary.nounLabel}.
              </p>
            </div>

            <button
              type="button"
              onClick={cancel}
              disabled={applying}
              className={buttonClassName('ghost')}
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.03] p-4">
            <InfoRow label={summary.primaryLabel}>
              {summary.primaryValue}
            </InfoRow>
          </section>

          {outsideWorkingHours && !isBlock ? (
            <section className="mt-4 rounded-2xl border border-toneWarn/25 bg-toneWarn/10 p-4">
              <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-toneWarn">
                Outside working hours
              </p>

              <p className="mt-2 text-sm leading-6 text-[var(--paper-dim)]">
                Clients cannot normally book this time. You can still place the
                appointment here, but the override needs a reason.
              </p>
            </section>
          ) : null}

          {needsOverrideReason ? (
            <section className="mt-4">
              <label htmlFor="calendar-override-reason">
                <span className="mb-1 block font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
                  Reason for override
                </span>

                <textarea
                  id="calendar-override-reason"
                  value={overrideReason}
                  onChange={(event) =>
                    onChangeOverrideReason(event.target.value)
                  }
                  rows={4}
                  maxLength={MAX_OVERRIDE_REASON_LENGTH}
                  placeholder="Explain why this appointment needs to be scheduled outside working hours."
                  className={textareaClassName()}
                  disabled={applying}
                />
              </label>

              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] font-black uppercase tracking-[0.08em] text-[var(--paper-mute)]">
                <span>Required</span>
                <span>
                  {overrideReason.length}/{MAX_OVERRIDE_REASON_LENGTH}
                </span>
              </div>
            </section>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line-strong)] bg-[var(--ink)]/92 px-4 py-4 backdrop-blur-xl sm:px-5">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancel}
              disabled={applying}
              className={buttonClassName('ghost')}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={buttonClassName('primary')}
              title={
                needsOverrideReason && trimmedOverrideReason.length === 0
                  ? 'Add a reason before saving outside working hours.'
                  : ''
              }
            >
              {applying ? 'Applying…' : summary.confirmLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function InfoRow(props: {
  label: string
  children: ReactNode
}) {
  const { label, children } = props

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2">
      <p className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
        {label}
      </p>

      <p className="mt-1 text-sm font-semibold text-[var(--paper)]">
        {children}
      </p>
    </div>
  )
}