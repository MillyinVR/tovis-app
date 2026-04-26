// app/pro/calendar/_components/MobilePendingRequestBar.tsx
'use client'

import type { CalendarEvent } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobilePendingRequestBarProps = {
  event: CalendarEvent | undefined
  pendingCount: number
  busy: boolean
  error: string | null
  onOpenAll: () => void
  onApprove: () => void
  onDeny: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function cleanLabel(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  return trimmed || fallback
}

function pendingTitle(args: {
  clientName: string
  title: string
  moreCount: number
}): string {
  const { clientName, title, moreCount } = args
  const base = `${clientName} — ${title}`

  if (moreCount <= 0) return base

  return `${base} + ${moreCount} more`
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobilePendingRequestBar(props: MobilePendingRequestBarProps) {
  const {
    event,
    pendingCount,
    busy,
    error,
    onOpenAll,
    onApprove,
    onDeny,
  } = props

  if (!event || event.kind !== 'BOOKING' || pendingCount <= 0) return null

  const clientName = cleanLabel(event.clientName, 'Client')
  const title = cleanLabel(event.title, 'Appointment')
  const moreCount = pendingCount - 1

  return (
    <div className="brand-pro-calendar-pending-bar">
      <div className="brand-pro-calendar-pending-shell">
        <button
          type="button"
          onClick={onOpenAll}
          className="brand-pro-calendar-pending-count brand-focus"
          aria-label="Open all pending requests"
        >
          {pendingCount}
        </button>

        <button
          type="button"
          onClick={onOpenAll}
          className="brand-pro-calendar-pending-body brand-focus text-left"
          aria-label="Open pending booking requests"
        >
          <p className="brand-pro-calendar-pending-label">
            ◆ Pending request
          </p>

          <p className="brand-pro-calendar-pending-title">
            {pendingTitle({
              clientName,
              title,
              moreCount,
            })}
          </p>
        </button>

        <button
          type="button"
          onClick={(clickEvent) => {
            clickEvent.stopPropagation()
            onApprove()
          }}
          disabled={busy}
          className={[
            'brand-pro-calendar-pending-action brand-focus',
            'disabled:cursor-wait disabled:opacity-60',
          ].join(' ')}
          data-action="approve"
          aria-label="Approve pending booking"
          title="Approve pending booking"
        >
          ✓
        </button>

        <button
          type="button"
          onClick={(clickEvent) => {
            clickEvent.stopPropagation()
            onDeny()
          }}
          disabled={busy}
          className={[
            'brand-pro-calendar-pending-action brand-focus',
            'disabled:cursor-wait disabled:opacity-60',
          ].join(' ')}
          data-action="deny"
          aria-label="Deny pending booking"
          title="Deny pending booking"
        >
          ×
        </button>
      </div>

      {error ? (
        <p
          className="mt-2 rounded-xl border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-xs font-semibold text-toneDanger"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}