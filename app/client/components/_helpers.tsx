// app/client/components/_helpers.tsx
import React from 'react'
import { sanitizeTimeZone } from '@/lib/timeZone'
import type { ClientBookingDTO } from '@/lib/dto/clientBooking'

/**
 * Single source of truth:
 * Client UI booking shape = ClientBookingDTO returned by GET /api/client/bookings
 */
export type BookingLike = ClientBookingDTO

/**
 * Waitlist shape returned by GET /api/client/bookings (buckets.waitlist)
 * Keep it minimal and schema-correct (ProfessionalProfile has no city/state).
 */
export type WaitlistLike = {
  id: string
  createdAt?: string | Date | null
  notes?: string | null

  preferredStart?: string | null
  preferredEnd?: string | null
  preferredTimeBucket?: string | null

  service?: { id?: string; name?: string | null } | null
  professional?: {
    id?: string
    businessName?: string | null
    location?: string | null
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

export function statusUpper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

export function sourceUpper(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

/**
 * Format a timestamp in a specific timezone (IANA).
 * Always pass booking.timeZone from the API so UI is timezone-stable.
 * Fallback tz is UTC (matches booking page behavior).
 */
export function prettyWhen(v: unknown, timeZone?: string | null) {
  const d = toDate(v)
  if (!d) return 'Unknown time'

  const tz = sanitizeTimeZone(timeZone, 'UTC')

  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)
}

/**
 * Booking location label:
 * Prefer server-computed booking.locationLabel (it can use formattedAddress snapshot).
 * Fallback to ProfessionalProfile.location if needed.
 */
export function bookingLocationLabel(b: BookingLike | null | undefined) {
  if (!b) return ''
  if (typeof b.locationLabel === 'string' && b.locationLabel.trim()) return b.locationLabel.trim()

  const proLoc = b.professional?.location
  return typeof proLoc === 'string' && proLoc.trim() ? proLoc.trim() : ''
}

/**
 * Waitlist location label (no booking snapshot available):
 * Use ProfessionalProfile.location only.
 */
export function waitlistLocationLabel(p: WaitlistLike['professional'] | null | undefined) {
  const loc = p?.location
  return typeof loc === 'string' && loc.trim() ? loc.trim() : ''
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
