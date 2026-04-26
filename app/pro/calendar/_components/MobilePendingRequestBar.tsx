// app/pro/calendar/_components/MobilePendingRequestBar.tsx
'use client'

import type { BookingCalendarEvent, CalendarEvent } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MobilePendingRequestBarCopy = {
  label: string
  clientFallback: string
  appointmentFallback: string
  moreSuffix: string
  openAllLabel: string
  openRequestsLabel: string
  approveLabel: string
  denyLabel: string
}

type MobilePendingRequestBarProps = {
  copy: MobilePendingRequestBarCopy
  event: CalendarEvent | undefined
  pendingCount: number
  busy: boolean
  error: string | null
  onOpenAll: () => void
  onApprove: () => void
  onDeny: () => void
}

type PendingTitleArgs = {
  clientName: string
  title: string
  moreCount: number
  moreSuffix: string
}

type PendingActionButtonProps = {
  action: 'approve' | 'deny'
  label: string
  busy: boolean
  children: string
  onClick: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isPendingBookingEvent(
  event: CalendarEvent | undefined,
): event is BookingCalendarEvent {
  return event?.kind === 'BOOKING'
}

function cleanLabel(value: string | null | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  return trimmed || fallback
}

function pendingTitle(args: PendingTitleArgs): string {
  const { clientName, title, moreCount, moreSuffix } = args
  const base = `${clientName} — ${title}`

  if (moreCount <= 0) return base

  return `${base} + ${moreCount} ${moreSuffix}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PendingActionButton(props: PendingActionButtonProps) {
  const { action, label, busy, children, onClick } = props

  return (
    <button
      type="button"
      onClick={(clickEvent) => {
        clickEvent.stopPropagation()
        onClick()
      }}
      disabled={busy}
      className="brand-pro-calendar-pending-action brand-focus"
      data-action={action}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function MobilePendingRequestBar(props: MobilePendingRequestBarProps) {
  const {
    copy,
    event,
    pendingCount,
    busy,
    error,
    onOpenAll,
    onApprove,
    onDeny,
  } = props

  if (!isPendingBookingEvent(event) || pendingCount <= 0) return null

  const clientName = cleanLabel(event.clientName, copy.clientFallback)
  const title = cleanLabel(event.title, copy.appointmentFallback)
  const moreCount = pendingCount - 1

  return (
    <div
      className="brand-pro-calendar-pending-bar"
      data-busy={busy ? 'true' : 'false'}
    >
      <div className="brand-pro-calendar-pending-shell">
        <button
          type="button"
          onClick={onOpenAll}
          className="brand-pro-calendar-pending-count brand-focus"
          aria-label={copy.openAllLabel}
        >
          {pendingCount}
        </button>

        <button
          type="button"
          onClick={onOpenAll}
          className="brand-pro-calendar-pending-body brand-focus text-left"
          aria-label={copy.openRequestsLabel}
        >
          <p className="brand-pro-calendar-pending-label">{copy.label}</p>

          <p className="brand-pro-calendar-pending-title">
            {pendingTitle({
              clientName,
              title,
              moreCount,
              moreSuffix: copy.moreSuffix,
            })}
          </p>
        </button>

        <PendingActionButton
          action="approve"
          label={copy.approveLabel}
          busy={busy}
          onClick={onApprove}
        >
          ✓
        </PendingActionButton>

        <PendingActionButton
          action="deny"
          label={copy.denyLabel}
          busy={busy}
          onClick={onDeny}
        >
          ×
        </PendingActionButton>
      </div>

      {error ? (
        <p
          className="brand-pro-calendar-state mt-2"
          data-danger="true"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}