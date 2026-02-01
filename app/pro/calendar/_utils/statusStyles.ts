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

export type CardClasses = {
  // NOTE: no bg here on purpose — cards control their own readable surface
  border: string
  ring?: string
  // optional accent that can be used for a left bar
  accentBg?: string
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
 * Chip styles (small pill / chip UI).
 * These CAN include backgrounds because chips are small and meant to be tinted.
 */
export function eventChipClasses(ev: CalendarEventLike): ChipClasses {
  const status = String(ev.status || '').toUpperCase()

  if (ev.isBlocked || status === 'BLOCKED') {
    return {
      bg: 'bg-surfaceGlass/6',
      border: 'border-white/10',
      text: 'text-textPrimary',
      ring: 'ring-white/8',
    }
  }

  const accepted: ChipClasses = {
    bg: 'bg-accentPrimary/10',
    border: 'border-white/12',
    text: 'text-textPrimary',
    ring: 'ring-accentPrimary/12',
  }

  switch (status) {
    case 'PENDING':
    case 'RESCHEDULE_REQUESTED':
      return {
        bg: 'bg-toneWarn/7',
        border: 'border-toneWarn/18',
        text: 'text-textPrimary',
        ring: 'ring-toneWarn/10',
      }

    case 'CANCELLED':
    case 'DECLINED':
    case 'NO_SHOW':
      return {
        bg: 'bg-toneDanger/7',
        border: 'border-toneDanger/18',
        text: 'text-textPrimary',
        ring: 'ring-toneDanger/10',
      }

    case 'COMPLETED':
      return {
        bg: 'bg-toneSuccess/6',
        border: 'border-toneSuccess/16',
        text: 'text-textPrimary',
        ring: 'ring-toneSuccess/8',
      }

    case 'ACCEPTED':
    default:
      return accepted
  }
}

/**
 * Card styles (calendar event blocks).
 * IMPORTANT: no bg class returned so DayColumn can keep a readable base surface.
 */
export function eventCardClasses(ev: CalendarEventLike): CardClasses {
  const status = String(ev.status || '').toUpperCase()

  if (ev.isBlocked || status === 'BLOCKED') {
    return {
      border: 'border-white/12',
      ring: 'ring-white/10',
      accentBg: 'bg-white/20',
    }
  }

  switch (status) {
    case 'PENDING':
    case 'RESCHEDULE_REQUESTED':
      return {
        border: 'border-toneWarn/18',
        ring: 'ring-toneWarn/12',
        accentBg: 'bg-toneWarn/70',
      }

    case 'CANCELLED':
    case 'DECLINED':
    case 'NO_SHOW':
      return {
        border: 'border-toneDanger/18',
        ring: 'ring-toneDanger/12',
        accentBg: 'bg-toneDanger/70',
      }

    case 'COMPLETED':
      return {
        border: 'border-toneSuccess/16',
        ring: 'ring-toneSuccess/10',
        accentBg: 'bg-toneSuccess/70',
      }

    case 'ACCEPTED':
    default:
      return {
        border: 'border-white/12',
        ring: 'ring-accentPrimary/14',
        accentBg: 'bg-accentPrimary/70',
      }
  }
}

/**
 * When you want a single className string for CHIPS.
 */
export function eventChipClassName(ev: CalendarEventLike): string {
  const c = eventChipClasses(ev)
  return `${c.bg} ${c.border} ${c.text} ${c.ring || ''}`.trim()
}

/**
 * When you want a single className string for CALENDAR CARDS.
 * (No bg included by design.)
 */
export function eventCardClassName(ev: CalendarEventLike): string {
  const c = eventCardClasses(ev)
  return `${c.border} ${c.ring || ''}`.trim()
}

/**
 * Optional helper for a left accent strip inside the card.
 */
export function eventAccentBgClassName(ev: CalendarEventLike): string {
  return eventCardClasses(ev).accentBg || 'bg-white/20'
}
