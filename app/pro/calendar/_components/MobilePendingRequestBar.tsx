// app/pro/calendar/_components/MobilePendingRequestBar.tsx
'use client'

import { PendingRequestSurface } from './PendingRequestSurface'

import type { BrandProCalendarPendingRequestCopy } from '@/lib/brand/types'

import type { CalendarEvent } from '../_types'

// ─── Types ────────────────────────────────────────────────────────────────────

type MobilePendingRequestBarProps = {
  copy: BrandProCalendarPendingRequestCopy
  event: CalendarEvent | undefined
  pendingCount: number
  busy: boolean
  error: string | null
  onOpenAll: () => void
  onApprove: () => void
  onDeny: () => void
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

  return (
    <div
      className="brand-pro-calendar-pending-bar"
      data-busy={busy ? 'true' : 'false'}
    >
      <PendingRequestSurface
        copy={copy}
        event={event}
        pendingCount={pendingCount}
        busy={busy}
        error={error}
        variant="mobile"
        actionMode="icon"
        onOpenAll={onOpenAll}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    </div>
  )
}