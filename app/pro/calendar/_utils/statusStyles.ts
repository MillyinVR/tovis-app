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
  ring?: string
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

  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Returns Tailwind class names for event chips / blocks (as an object).
 * Design goals:
 * - Calm base contrast (luxury)
 * - Clear meaning (trust)
 * - No neon / no harsh borders
 */
export function eventChipClasses(ev: CalendarEventLike): ChipClasses {
  const status = String(ev.status || '').toUpperCase()

  // BLOCKED
  if (ev.isBlocked || status === 'BLOCKED') {
    return {
      bg: 'bg-bgSecondary/45',
      border: 'border-white/10',
      text: 'text-textPrimary',
      ring: 'ring-white/8',
    }
  }

  switch (status) {
    case 'PENDING':
    case 'RESCHEDULE_REQUESTED':
      return {
        bg: 'bg-amber-500/7',
        border: 'border-amber-500/22',
        text: 'text-textPrimary',
        ring: 'ring-amber-500/12',
      }

    case 'CANCELLED':
    case 'DECLINED':
    case 'NO_SHOW':
      return {
        bg: 'bg-red-500/7',
        border: 'border-red-500/22',
        text: 'text-textPrimary',
        ring: 'ring-red-500/12',
      }

    case 'COMPLETED':
      return {
        bg: 'bg-emerald-500/7',
        border: 'border-emerald-500/22',
        text: 'text-textPrimary',
        ring: 'ring-emerald-500/12',
      }

    case 'ACCEPTED':
    default:
      // Primary money/status = accentPrimary (your gold)
      return {
        bg: 'bg-accentPrimary/10',
        border: 'border-accentPrimary/26',
        text: 'text-textPrimary',
        ring: 'ring-accentPrimary/14',
      }
  }
}

/**
 * When you want a single className string for the chip.
 */
export function eventChipClassName(ev: CalendarEventLike): string {
  const c = eventChipClasses(ev)
  return `${c.bg} ${c.border} ${c.text} ${c.ring || ''}`
}
