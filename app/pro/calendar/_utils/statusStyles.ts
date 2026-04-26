// app/pro/calendar/_utils/statusStyles.ts

/**
 * Centralized presentation helpers for calendar event statuses.
 *
 * Used by:
 * - Day/week event cards
 * - Month chips/dots
 * - Management modal rows
 * - Mobile pending request surfaces
 *
 * Rules:
 * - No hex colors.
 * - No casts.
 * - No duplicated status branching in components.
 * - Components should ask this file for status labels/classes/tone.
 *
 * Important:
 * - EventCard emits data-calendar-event-tone / data-calendar-event-kind.
 * - brand.css owns card fill, shadow, blocked patterns, and white-label visuals.
 * - This file owns status meaning, labels, chips, badges, borders, rings, and accent stripes.
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
  | 'waitlist'
  | 'scheduled'

export type ChipClasses = {
  bg: string
  border: string
  text: string
  ring?: string
}

export type CardClasses = {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const BLOCKED_STATUS = 'BLOCKED'

const ACCEPTED_STATUSES = new Set<string>(['ACCEPTED', 'CONFIRMED'])
const PENDING_STATUSES = new Set<string>(['PENDING', 'RESCHEDULE_REQUESTED'])
const COMPLETED_STATUSES = new Set<string>(['COMPLETED'])
const DANGER_STATUSES = new Set<string>([
  'CANCELLED',
  'DECLINED',
  'NO_SHOW',
])
const WAITLIST_STATUSES = new Set<string>(['WAITLIST'])

const STATUS_LABELS: Record<string, string> = {
  ACCEPTED: 'Accepted',
  CONFIRMED: 'Accepted',
  PENDING: 'Pending',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DECLINED: 'Declined',
  NO_SHOW: 'No show',
  RESCHEDULE_REQUESTED: 'Reschedule requested',
  WAITLIST: 'Waitlist',
  BLOCKED: 'Blocked',
}

const STATUS_PRESENTATION: Record<StatusTone, StatusPresentation> = {
  accepted: {
    tone: 'accepted',
    chip: {
      bg: 'bg-terra/10',
      border: 'border-terra/25',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-terra/15',
    },
    card: {
      border: 'border-terra/45',
      ring: 'ring-1 ring-inset ring-terra/30',
      accentBg: 'bg-terra',
    },
    badge: 'border-terra/25 bg-terra/10 text-textPrimary',
  },

  pending: {
    tone: 'pending',
    chip: {
      bg: 'bg-tonePending/10',
      border: 'border-tonePending/25',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-tonePending/15',
    },
    card: {
      border: 'border-tonePending/50',
      ring: 'ring-1 ring-inset ring-tonePending/35',
      accentBg: 'bg-tonePending',
    },
    badge: 'border-tonePending/30 bg-tonePending/10 text-tonePending',
  },

  completed: {
    tone: 'completed',
    chip: {
      bg: 'bg-toneSuccess/10',
      border: 'border-toneSuccess/25',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-toneSuccess/15',
    },
    card: {
      border: 'border-toneSuccess/45',
      ring: 'ring-1 ring-inset ring-toneSuccess/30',
      accentBg: 'bg-toneSuccess',
    },
    badge: 'border-toneSuccess/25 bg-toneSuccess/10 text-toneSuccess',
  },

  danger: {
    tone: 'danger',
    chip: {
      bg: 'bg-toneDanger/10',
      border: 'border-toneDanger/25',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-toneDanger/15',
    },
    card: {
      border: 'border-toneDanger/45',
      ring: 'ring-1 ring-inset ring-toneDanger/30',
      accentBg: 'bg-toneDanger',
    },
    badge: 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger',
  },

  blocked: {
    tone: 'blocked',
    chip: {
      bg: 'bg-paper/10',
      border: 'border-paper/15',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-paper/10',
    },
    card: {
      border: 'border-paper/20',
      ring: 'ring-1 ring-inset ring-paper/10',
      accentBg: 'bg-paper/30',
    },
    badge: 'border-paper/15 bg-paper/10 text-textSecondary',
  },

  waitlist: {
    tone: 'waitlist',
    chip: {
      bg: 'bg-acid/10',
      border: 'border-acid/25',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-acid/15',
    },
    card: {
      border: 'border-acid/40',
      ring: 'ring-1 ring-inset ring-acid/25',
      accentBg: 'bg-acid',
    },
    badge: 'border-acid/25 bg-acid/10 text-acid',
  },

  scheduled: {
    tone: 'scheduled',
    chip: {
      bg: 'bg-terra/10',
      border: 'border-terra/25',
      text: 'text-textPrimary',
      ring: 'ring-1 ring-inset ring-terra/15',
    },
    card: {
      border: 'border-terra/45',
      ring: 'ring-1 ring-inset ring-terra/30',
      accentBg: 'bg-terra',
    },
    badge: 'border-terra/25 bg-terra/10 text-textPrimary',
  },
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeStatus(status?: string | null): string {
  return typeof status === 'string' ? status.trim().toUpperCase() : ''
}

function humanizeStatus(normalizedStatus: string): string {
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

  if (WAITLIST_STATUSES.has(normalizedStatus)) {
    return 'waitlist'
  }

  if (PENDING_STATUSES.has(normalizedStatus)) {
    return 'pending'
  }

  if (DANGER_STATUSES.has(normalizedStatus)) {
    return 'danger'
  }

  if (COMPLETED_STATUSES.has(normalizedStatus)) {
    return 'completed'
  }

  if (ACCEPTED_STATUSES.has(normalizedStatus)) {
    return 'accepted'
  }

  return 'scheduled'
}

function isPresentClassName(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function joinClasses(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter(isPresentClassName).join(' ')
}

// ─── Public helpers ───────────────────────────────────────────────────────────

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

export function eventStatusTone(event: CalendarEventLike): StatusTone {
  return calendarStatusMeta(event).tone
}

/**
 * Small pill/chip UI.
 * These can include backgrounds because chips are intentionally tinted.
 */
export function eventChipClasses(event: CalendarEventLike): ChipClasses {
  return calendarStatusMeta(event).chip
}

/**
 * Calendar event block chrome.
 * The card fill, shadow, and blocked pattern belong in brand.css.
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