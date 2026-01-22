// app/client/components/_helpers.tsx
import React from 'react'
import { sanitizeTimeZone } from '@/lib/timeZone'

export type BookingStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'WAITLIST'
  | 'BLOCKED'
  | (string & {})

export type BookingSource =
  | 'REQUESTED'
  | 'DISCOVERY'
  | 'AFTERCARE'
  | (string & {})

export type Consultation = {
  consultationNotes?: string | null
  consultationPrice?: string | null
  consultationConfirmedAt?: string | null

  approvalStatus?: string | null
  approvalNotes?: string | null
  proposedTotal?: string | null
  proposedServicesJson?: unknown

  approvedAt?: string | null
  rejectedAt?: string | null
} | null

export type BookingLike = {
  id: string

  status?: BookingStatus | null
  source?: BookingSource | null

  scheduledFor?: string | Date | null
  durationMinutesSnapshot?: number | null
  priceSnapshot?: unknown

  // ✅ canonical consult payload (if you show consult in client UI)
  consultation?: Consultation

  // ✅ badge support (if you show “NEW aftercare”)
  hasUnreadAftercare?: boolean

  // ✅ computed by API for UI convenience (optional)
  hasPendingConsultationApproval?: boolean

  // ✅ service + pro display
  service?: { id?: string; name?: string | null } | null
  professional?: {
    id?: string
    businessName?: string | null
    location?: string | null
    city?: string | null
    state?: string | null
    timeZone?: string | null
  } | null

  // ✅ strongest source of truth for display timezone in client UI
  timeZone?: string | null
}

export type WaitlistLike = {
  id: string
  createdAt?: string | Date | null
  notes?: string | null
  availability?: unknown

  service?: { id?: string; name?: string | null } | null
  professional?: {
    id?: string
    businessName?: string | null
    location?: string | null
    city?: string | null
    state?: string | null
    timeZone?: string | null
  } | null
}

export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Format a timestamp in a specific timezone (IANA).
 * IMPORTANT: pass booking/pro timezone so client UI isn't viewer-timezone-dependent.
 */
export function prettyWhen(v: unknown, timeZone?: string | null) {
  const d = toDate(v)
  if (!d) return 'Unknown time'

  const tz = timeZone ? sanitizeTimeZone(timeZone, 'America/Los_Angeles') : undefined

  return d.toLocaleString(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function locationLabel(p: BookingLike['professional'] | WaitlistLike['professional']) {
  if (!p) return ''
  const parts = [p.location, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean)
  return parts.join(' · ')
}

export function statusUpper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function sourceUpper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function Badge({
  label,
  variant = 'default',
}: {
  label: string
  variant?: 'default' | 'accent' | 'danger' | 'success'
}) {
  const cls =
    variant === 'accent'
      ? 'bg-accentPrimary text-bgPrimary'
      : variant === 'danger'
        ? 'bg-microAccent text-bgPrimary'
        : variant === 'success'
          ? 'bg-emerald-400 text-bgPrimary'
          : 'bg-bgSecondary text-textPrimary border border-white/10'

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black whitespace-nowrap',
        cls,
      ].join(' ')}
    >
      {label}
    </span>
  )
}
