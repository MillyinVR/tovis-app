// app/pro/calendar/_utils/statusStyles.ts

/**
 * Centralized visual styles for calendar event statuses.
 *
 * Used by:
 * - Day/week event cards
 * - Month chips
 * - Management modal rows
 * - Mobile pending request surfaces
 *
 * Rules:
 * - No hex colors.
 * - No casts.
 * - No duplicated status branching in components.
 * - Components should ask this file for labels/classes instead of rebuilding them.
 */

export type CalendarEventLike = {
  status?: string | null
  isBlocked?: boolean
}

export type StatusTone =
  | 'accepted'
  | 'pending'
  | 'completed'
  | 'danger'
  | 'blocked'
  | 'scheduled'

export type ChipClasses = {
  bg: string
  border: string
  text: string
  ring?: string
}

export type CardClasses = {
  /**
   * No background here on purpose.
   * Event cards own their readable base surface.
   */
  border: string
  ring?: string
  accentBg: string
}

export type StatusPresentation = {
  tone: StatusTone
  chip: ChipClasses
  card: CardClasses
  badge: string
}

export type CalendarStatusMeta = StatusPresentation & {
  normalizedStatus: string
  label: string
}

const BLOCKED_STATUS = 'BLOCKED'

const PENDING_STATUSES = new Set(['PENDING', 'RESCHEDULE_REQUESTED'])
const DANGER_STATUSES = new Set(['CANCELLED', 'DECLINED', 'NO_SHOW'])

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Accepted',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DECLINED: 'Declined',
  NO_SHOW: 'No show',
  RESCHEDULE_REQUESTED: 'Reschedule requested',
  BLOCKED: 'Blocked',
}

const STATUS_PRESENTATION: Record<StatusTone, StatusPresentation> = {
  accepted: {
    tone: 'accepted',
    chip: {
      bg: 'bg-accentPrimary/[0.10]',
      border: 'border-white/[0.12]',
      text: 'text-textPrimary',
      ring: 'ring-accentPrimary/[0.12]',
    },
    card: {
      border: 'border-white/[0.12]',
      ring: 'ring-accentPrimary/[0.14]',
      accentBg: 'bg-accentPrimary/[0.70]',
    },
    badge:
      'border-accentPrimary/[0.20] bg-accentPrimary/[0.10] text-textPrimary',
  },

  pending: {
    tone: 'pending',
    chip: {
      bg: 'bg-toneWarn/[0.07]',
      border: 'border-toneWarn/[0.18]',
      text: 'text-textPrimary',
      ring: 'ring-toneWarn/[0.10]',
    },
    card: {
      border: 'border-toneWarn/[0.18]',
      ring: 'ring-toneWarn/[0.12]',
      accentBg: 'bg-toneWarn/[0.70]',
    },
    badge: 'border-toneWarn/[0.25] bg-toneWarn/[0.10] text-toneWarn',
  },

  completed: {
    tone: 'completed',
    chip: {
      bg: 'bg-toneSuccess/[0.06]',
      border: 'border-toneSuccess/[0.16]',
      text: 'text-textPrimary',
      ring: 'ring-toneSuccess/[0.08]',
    },
    card: {
      border: 'border-toneSuccess/[0.16]',
      ring: 'ring-toneSuccess/[0.10]',
      accentBg: 'bg-toneSuccess/[0.70]',
    },
    badge:
      'border-toneSuccess/[0.20] bg-toneSuccess/[0.10] text-toneSuccess',
  },

  danger: {
    tone: 'danger',
    chip: {
      bg: 'bg-toneDanger/[0.07]',
      border: 'border-toneDanger/[0.18]',
      text: 'text-textPrimary',
      ring: 'ring-toneDanger/[0.10]',
    },
    card: {
      border: 'border-toneDanger/[0.18]',
      ring: 'ring-toneDanger/[0.12]',
      accentBg: 'bg-toneDanger/[0.70]',
    },
    badge: 'border-toneDanger/[0.25] bg-toneDanger/[0.10] text-toneDanger',
  },

  blocked: {
    tone: 'blocked',
    chip: {
      bg: 'bg-surfaceGlass/[0.06]',
      border: 'border-white/[0.10]',
      text: 'text-textPrimary',
      ring: 'ring-white/[0.08]',
    },
    card: {
      border: 'border-white/[0.12]',
      ring: 'ring-white/[0.10]',
      accentBg: 'bg-white/[0.20]',
    },
    badge: 'border-white/[0.10] bg-white/[0.10] text-textSecondary',
  },

  scheduled: {
    tone: 'scheduled',
    chip: {
      bg: 'bg-accentPrimary/[0.10]',
      border: 'border-white/[0.12]',
      text: 'text-textPrimary',
      ring: 'ring-accentPrimary/[0.12]',
    },
    card: {
      border: 'border-white/[0.12]',
      ring: 'ring-accentPrimary/[0.14]',
      accentBg: 'bg-accentPrimary/[0.70]',
    },
    badge:
      'border-accentPrimary/[0.20] bg-accentPrimary/[0.10] text-textPrimary',
  },
}

function normalizeStatus(status?: string | null) {
  return typeof status === 'string' ? status.trim().toUpperCase() : ''
}

function humanizeStatus(normalizedStatus: string) {
  if (!normalizedStatus) return 'Scheduled'

  const explicitLabel = STATUS_LABELS[normalizedStatus]
  if (explicitLabel) return explicitLabel

  return normalizedStatus
    .toLowerCase()
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function statusToneForEvent(event: CalendarEventLike): StatusTone {
  const normalizedStatus = normalizeStatus(event.status)

  if (event.isBlocked || normalizedStatus === BLOCKED_STATUS) {
    return 'blocked'
  }

  if (PENDING_STATUSES.has(normalizedStatus)) {
    return 'pending'
  }

  if (DANGER_STATUSES.has(normalizedStatus)) {
    return 'danger'
  }

  if (normalizedStatus === 'COMPLETED') {
    return 'completed'
  }

  if (normalizedStatus === 'ACCEPTED') {
    return 'accepted'
  }

  return 'scheduled'
}

function joinClasses(parts: ReadonlyArray<string | undefined>) {
  return parts.filter(isPresentClassName).join(' ')
}

function isPresentClassName(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

export function calendarStatusMeta(event: CalendarEventLike): CalendarStatusMeta {
  const normalizedStatus = normalizeStatus(event.status)
  const tone = statusToneForEvent(event)
  const presentation = STATUS_PRESENTATION[tone]

  return {
    normalizedStatus,
    label: humanizeStatus(normalizedStatus),
    tone: presentation.tone,
    chip: presentation.chip,
    card: presentation.card,
    badge: presentation.badge,
  }
}

export function statusLabel(status?: string | null): string {
  return humanizeStatus(normalizeStatus(status))
}

/**
 * Small pill/chip UI.
 * These can include backgrounds because chips are intentionally tinted.
 */
export function eventChipClasses(event: CalendarEventLike): ChipClasses {
  return calendarStatusMeta(event).chip
}

/**
 * Calendar event block styling.
 * Background is intentionally excluded so cards can own readable surfaces.
 */
export function eventCardClasses(event: CalendarEventLike): CardClasses {
  return calendarStatusMeta(event).card
}

export function eventBadgeClassName(event: CalendarEventLike): string {
  return calendarStatusMeta(event).badge
}

export function eventChipClassName(event: CalendarEventLike): string {
  const classes = eventChipClasses(event)

  return joinClasses([
    classes.bg,
    classes.border,
    classes.text,
    classes.ring,
  ])
}

export function eventCardClassName(event: CalendarEventLike): string {
  const classes = eventCardClasses(event)

  return joinClasses([
    classes.border,
    classes.ring,
  ])
}

export function eventAccentBgClassName(event: CalendarEventLike): string {
  return eventCardClasses(event).accentBg
}