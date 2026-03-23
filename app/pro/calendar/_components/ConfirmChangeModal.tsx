// app/pro/calendar/_components/ConfirmChangeModal.tsx
'use client'

import type { PendingChange } from '../_types'

type Props = {
  open: boolean
  change: PendingChange | null
  applying: boolean
  outsideWorkingHours?: boolean
  overrideReason: string
  onChangeOverrideReason: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}

function formatLocal(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ConfirmChangeModal(props: Props) {
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

  if (!open || !change) return null

  const isBlock = change.entityType === 'block'
  const noun = isBlock ? 'blocked time' : 'appointment'
  const verb = change.kind === 'resize' ? 'resize' : 'move'
  const needsReason = outsideWorkingHours && !isBlock
  const confirmDisabled = applying || (needsReason && !overrideReason.trim())

  const primaryLine =
    change.kind === 'resize' ? (
      <>
        New duration:{' '}
        <span className="font-semibold text-textPrimary">
          {Number(change.nextTotalDurationMinutes ?? 0)} min
        </span>
      </>
    ) : (
      <>
        New start time:{' '}
        <span className="font-semibold text-textPrimary">{formatLocal(change.nextStartIso)}</span>
      </>
    )

  return (
    <div
      className="fixed inset-0 z-1200 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm calendar change"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-130 overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-textPrimary">Confirm change</div>
            <div className="mt-0.5 text-xs text-textSecondary">
              You’re about to {verb} this {noun}.
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={applying}
            className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70 disabled:opacity-70"
          >
            Close
          </button>
        </div>

        <div className="p-4">
          <div className="text-sm text-textSecondary">{primaryLine}</div>

          {!isBlock && outsideWorkingHours ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-bgSecondary/40 p-3">
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-warning"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-textPrimary">Outside working hours</div>
                  <div className="mt-0.5 text-xs text-textSecondary">
                    Clients won’t be able to book this time, but you can place it here anyway.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {needsReason ? (
            <div className="mt-4">
              <label
                htmlFor="calendar-override-reason"
                className="mb-1 block text-xs font-semibold text-textPrimary"
              >
                Reason for override
              </label>
              <textarea
                id="calendar-override-reason"
                value={overrideReason}
                onChange={(e) => onChangeOverrideReason(e.target.value)}
                rows={3}
                placeholder="Explain why this appointment needs to be scheduled outside working hours."
                className="w-full rounded-2xl border border-white/10 bg-bgSecondary px-3 py-2 text-sm text-textPrimary outline-none placeholder:text-textSecondary/70"
                disabled={applying}
              />
              <div className="mt-1 text-[11px] text-textSecondary">
                Required when saving outside working hours.
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-xs font-semibold hover:bg-bgSecondary/70 disabled:opacity-70"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/70 disabled:opacity-70"
            >
              {applying ? 'Applying…' : outsideWorkingHours && !isBlock ? 'Save anyway' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}