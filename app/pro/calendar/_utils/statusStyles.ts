// app/pro/calendar/_utils/statusStyles.ts

/**
 * Centralized visual styles for calendar events.
 * Used by DayWeekGrid, MonthGrid, ManagementModal, etc.
 *
 * IMPORTANT:
 * - No hex colors
 * - Tailwind tokens only
 */

export type CalendarEventLike = {
  status?: string | null
  isBlocked?: boolean
}

export type ChipClasses = {
  bg: string
  border: string
  text: string
}

export function statusLabel(status?: string | null): string {
  const s = String(status || '').toUpperCase()

  if (!s) return 'Scheduled'
  if (s === 'ACCEPTED') return 'Accepted'
  if (s === 'PENDING') return 'Pending'
  if (s === 'COMPLETED') return 'Completed'
  if (s === 'CANCELLED') return 'Cancelled'
  if (s === 'DECLINED') return 'Declined'
  if (s === 'NO_SHOW') return 'No show'
  if (s === 'RESCHEDULE_REQUESTED') return 'Reschedule requested'
  if (s === 'BLOCKED') return 'Blocked'

  // fallback for any new statuses you add later
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Returns Tailwind class names for event chips / blocks (as an object).
 */
export function eventChipClasses(ev: CalendarEventLike): ChipClasses {
  // BLOCKED TIME (personal / unavailable)
  if (ev.isBlocked || String(ev.status || '').toUpperCase() === 'BLOCKED') {
    return {
      bg: 'bg-bgSecondary',
      border: 'border-white/10',
      text: 'text-textSecondary',
    }
  }

  const status = String(ev.status || '').toUpperCase()

  switch (status) {
    case 'PENDING':
      return {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/40',
        text: 'text-amber-200',
      }

    case 'CANCELLED':
    case 'DECLINED':
      return {
        bg: 'bg-red-500/10',
        border: 'border-red-500/40',
        text: 'text-red-200',
      }

    case 'COMPLETED':
      return {
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/40',
        text: 'text-emerald-200',
      }

    case 'ACCEPTED':
    default:
      return {
        bg: 'bg-brand/10',
        border: 'border-brand/50',
        text: 'text-brand',
      }
  }
}

/**
 * When you want a single className string for the chip.
 */
export function eventChipClassName(ev: CalendarEventLike): string {
  const c = eventChipClasses(ev)
  return `${c.bg} ${c.border} ${c.text}`
}
