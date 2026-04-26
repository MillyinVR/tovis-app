// app/pro/calendar/_utils/statusStyles.ts

/**
 * Centralized status meaning helpers for calendar events.
 *
 * Rules:
 * - No hex colors.
 * - No casts.
 * - No Tailwind / visual class strings.
 * - No duplicated status branching in components.
 *
 * This file owns:
 * - status normalization
 * - status labels
 * - semantic status tones
 *
 * Brand CSS owns:
 * - card fill
 * - borders
 * - rings
 * - chips
 * - badges
 * - accent stripes
 * - blocked patterns
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

export type CalendarStatusMeta = {
  normalizedStatus: string
  label: string
  tone: StatusTone
  isBlocked: boolean
  isPending: boolean
  isCompleted: boolean
  isDanger: boolean
  isWaitlist: boolean
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

function statusToneForNormalizedStatus(args: {
  normalizedStatus: string
  isBlocked?: boolean
}): StatusTone {
  const { normalizedStatus, isBlocked = false } = args

  if (isBlocked || normalizedStatus === BLOCKED_STATUS) {
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

// ─── Public helpers ───────────────────────────────────────────────────────────

export function calendarStatusMeta(event: CalendarEventLike): CalendarStatusMeta {
  const normalizedStatus = normalizeStatus(event.status)

  const tone = statusToneForNormalizedStatus({
    normalizedStatus,
    isBlocked: event.isBlocked,
  })

  return {
    normalizedStatus,
    label: humanizeStatus(normalizedStatus),
    tone,
    isBlocked: tone === 'blocked',
    isPending: tone === 'pending',
    isCompleted: tone === 'completed',
    isDanger: tone === 'danger',
    isWaitlist: tone === 'waitlist',
  }
}

export function statusLabel(status?: string | null): string {
  return humanizeStatus(normalizeStatus(status))
}

export function eventStatusTone(event: CalendarEventLike): StatusTone {
  return calendarStatusMeta(event).tone
}

export function isPendingStatus(status?: string | null): boolean {
  return eventStatusTone({ status }) === 'pending'
}

export function isCompletedStatus(status?: string | null): boolean {
  return eventStatusTone({ status }) === 'completed'
}

export function isDangerStatus(status?: string | null): boolean {
  return eventStatusTone({ status }) === 'danger'
}

export function isWaitlistStatus(status?: string | null): boolean {
  return eventStatusTone({ status }) === 'waitlist'
}

export function isBlockedStatus(status?: string | null): boolean {
  return eventStatusTone({ status }) === 'blocked'
}