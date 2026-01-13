// app/pro/calendar/_components/ConfirmChangeModal.tsx

'use client'

import type { PendingChange } from '../_types'

export function ConfirmChangeModal(props: {
  open: boolean
  change: PendingChange | null
  applying: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { open, change, applying, onCancel, onConfirm } = props
  if (!open || !change) return null

  return (
    <div className="fixed inset-0 z-1200 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-130 overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div className="font-extrabold">Apply changes?</div>
          <button type="button" onClick={onCancel} className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1.5 text-xs font-semibold hover:bg-bgSecondary/70">
            Close
          </button>
        </div>

        <div className="p-4">
          <div className="mb-2 text-sm font-extrabold">
            You changed this {change.entityType === 'block' ? 'blocked time' : 'appointment'} by {change.kind === 'resize' ? 'resizing' : 'moving'} it.
          </div>

          <div className="text-sm text-textSecondary">
            {change.kind === 'resize' ? (
              <>
                New duration: <span className="font-semibold text-textPrimary">{change.nextTotalDurationMinutes} min</span>
              </>
            ) : (
              <>
                New start time:{' '}
                <span className="font-semibold text-textPrimary">
                  {new Date(change.nextStartIso).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </>
            )}
          </div>

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
              disabled={applying}
              className="rounded-full bg-bgSecondary px-4 py-2 text-xs font-extrabold hover:bg-bgSecondary/70 disabled:opacity-70"
            >
              {applying ? 'Applying…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
