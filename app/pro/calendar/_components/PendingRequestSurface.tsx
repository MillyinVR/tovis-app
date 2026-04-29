// app/pro/calendar/_components/PendingRequestSurface.tsx
'use client'

import type { ReactNode } from 'react'

import type { BrandProCalendarPendingRequestCopy } from '@/lib/brand/types'

import type { BookingCalendarEvent, CalendarEvent } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PendingRequestSurfaceVariant = 'mobile' | 'tablet' | 'desktop'

export type PendingRequestActionMode = 'icon' | 'label'

type PendingRequestSurfaceProps = {
  copy: BrandProCalendarPendingRequestCopy
  event: CalendarEvent | undefined
  pendingCount: number
  busy: boolean
  error: string | null
  variant: PendingRequestSurfaceVariant
  onOpenAll: () => void
  onApprove: () => void
  onDeny: () => void
  actionMode?: PendingRequestActionMode
  showOpenAllAction?: boolean
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
  mode: PendingRequestActionMode
  children: ReactNode
  onClick: () => void
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isBookingCalendarEvent(
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

function resolveActionMode(args: {
  variant: PendingRequestSurfaceVariant
  actionMode: PendingRequestActionMode | undefined
}): PendingRequestActionMode {
  const { variant, actionMode } = args

  if (actionMode) return actionMode

  return variant === 'mobile' ? 'icon' : 'label'
}

function actionButtonClassName(mode: PendingRequestActionMode): string {
  if (mode === 'icon') {
    return 'brand-pro-calendar-pending-action brand-focus'
  }

  return 'brand-pro-calendar-management-button brand-focus'
}

function actionButtonTone(action: 'approve' | 'deny'): string {
  return action === 'approve' ? 'primary' : 'ghost'
}

function actionButtonContent(args: {
  mode: PendingRequestActionMode
  action: 'approve' | 'deny'
  label: string
}): ReactNode {
  const { mode, action, label } = args

  if (mode === 'label') return label

  return action === 'approve' ? '✓' : '×'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PendingActionButton(props: PendingActionButtonProps) {
  const { action, label, busy, mode, children, onClick } = props

  return (
    <button
      type="button"
      onClick={(clickEvent) => {
        clickEvent.stopPropagation()
        onClick()
      }}
      disabled={busy}
      className={actionButtonClassName(mode)}
      data-action={action}
      data-tone={mode === 'label' ? actionButtonTone(action) : undefined}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

// ─── Exported component ───────────────────────────────────────────────────────

export function PendingRequestSurface(props: PendingRequestSurfaceProps) {
  const {
    copy,
    event,
    pendingCount,
    busy,
    error,
    variant,
    onOpenAll,
    onApprove,
    onDeny,
    actionMode,
    showOpenAllAction = false,
  } = props

  if (!isBookingCalendarEvent(event) || pendingCount <= 0) return null

  const resolvedActionMode = resolveActionMode({ variant, actionMode })

  const clientName = cleanLabel(event.clientName, copy.clientFallback)
  const title = cleanLabel(event.title, copy.appointmentFallback)
  const moreCount = pendingCount - 1

  return (
    <div
      className="brand-pro-calendar-pending-surface"
      data-variant={variant}
      data-busy={busy ? 'true' : 'false'}
    >
      <div className="brand-pro-calendar-pending-shell brand-pro-calendar-pending-surface-shell">
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
          className="brand-pro-calendar-pending-body brand-pro-calendar-pending-surface-body brand-focus text-left"
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

        <div className="brand-pro-calendar-pending-surface-actions">
          <PendingActionButton
            action="approve"
            label={copy.approveLabel}
            busy={busy}
            mode={resolvedActionMode}
            onClick={onApprove}
          >
            {actionButtonContent({
              mode: resolvedActionMode,
              action: 'approve',
              label: copy.approveLabel,
            })}
          </PendingActionButton>

          <PendingActionButton
            action="deny"
            label={copy.denyLabel}
            busy={busy}
            mode={resolvedActionMode}
            onClick={onDeny}
          >
            {actionButtonContent({
              mode: resolvedActionMode,
              action: 'deny',
              label: copy.denyLabel,
            })}
          </PendingActionButton>

          {showOpenAllAction ? (
            <button
              type="button"
              onClick={onOpenAll}
              className="brand-pro-calendar-management-button brand-focus"
              data-tone="ghost"
            >
              {copy.openAllLabel}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          className="brand-pro-calendar-pending-surface-error brand-pro-calendar-state"
          data-danger="true"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}