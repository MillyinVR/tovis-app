// app/client/(gated)/_components/UpcomingAppointmentCard.tsx
import Link from 'next/link'

import { asTrimmedString } from '@/lib/guards'
import { initialsForName } from '@/lib/initials'
import RemoteImage from '@/app/_components/media/RemoteImage'

import type { ClientHomeBooking } from '../_data/getClientHomeData'
import { bookingTitle } from './bookingDisplay'
import {
  formatDateTime,
  formatDuration,
  gradientAvatar,
  money,
  professionalName,
} from './homeVisuals'

function bookingLocation(booking: ClientHomeBooking): string | null {
  return (
    booking.location?.name ??
    booking.location?.city ??
    asTrimmedString(booking.locationAddressSnapshot) ??
    booking.professional.location ??
    null
  )
}

function bookingTimeZone(booking: ClientHomeBooking): string | null {
  return (
    booking.locationTimeZone ??
    booking.location?.timeZone ??
    booking.professional.timeZone ??
    null
  )
}

function EmptyUpcomingCard() {
  return (
    <div className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Next booking
        </span>
      </div>
      <p className="text-[13px] font-semibold text-textPrimary">
        No approved bookings yet.
      </p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-textMuted">
        When a pro approves your booking, it&apos;ll show up here.
      </p>
      <Link
        href="/discover"
        className="mt-3.5 inline-flex rounded-[12px] border border-textPrimary/16 px-4 py-2 text-[11.5px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
      >
        Find a pro
      </Link>
    </div>
  )
}

export default function UpcomingAppointmentCard({
  booking,
  upcomingCount = 0,
}: {
  booking: ClientHomeBooking | null
  upcomingCount?: number
}) {
  if (!booking) return <EmptyUpcomingCard />

  const title = bookingTitle(booking)
  const proName = professionalName(booking.professional)
  const location = bookingLocation(booking)
  const timeZone = bookingTimeZone(booking)
  const total = money(booking.totalAmount)
  const when = formatDateTime(booking.scheduledFor, timeZone)
  const duration = formatDuration(booking.totalDurationMinutes)
  const moreCount = Math.max(0, upcomingCount - 1)

  return (
    <div className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-[15px] flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Next booking
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-terra px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-terra" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-terra">
            Confirmed
          </span>
        </span>
      </div>

      <div className="mb-3.5 flex items-center gap-3">
        <div
          className="grid h-[46px] w-[46px] shrink-0 place-items-center overflow-hidden rounded-[14px] text-xs font-bold text-onCta"
          style={{ background: gradientAvatar(0) }}
        >
          {booking.professional.avatarUrl ? (
            <RemoteImage
              src={booking.professional.avatarUrl}
              alt={proName}
              className="h-full w-full object-cover"
              width={46}
              height={46}
            />
          ) : (
            initialsForName(proName)
          )}
        </div>
        <div className="min-w-0">
          <Link
            href={`/professionals/${encodeURIComponent(booking.professional.id)}`}
            className="block truncate font-display text-[17px] font-semibold tracking-[-0.01em] text-textPrimary transition hover:opacity-80"
          >
            {proName}
          </Link>
          {location ? (
            <div className="mt-0.5 truncate text-[12.5px] text-textMuted">
              {location}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-textPrimary/10 pt-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[14.5px] font-semibold text-textPrimary">
            {title}
          </span>
          {total ? (
            <span className="font-display text-[14px] font-semibold text-terra">
              {total}
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-textMuted">
            {when}
          </span>
          {duration ? (
            <span className="font-mono text-[11px] text-textMuted/70">
              {duration}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex gap-2.5">
        <Link
          href={`/client/bookings/${encodeURIComponent(booking.id)}`}
          className="flex h-11 flex-1 items-center justify-center rounded-[14px] bg-cta font-display text-[13.5px] font-bold text-onCta shadow-[0_6px_20px_rgb(var(--accent-primary)/0.24)] transition hover:opacity-95"
        >
          View booking
        </Link>
        <Link
          href={`/client/bookings/${encodeURIComponent(booking.id)}?action=message`}
          aria-label="Message pro"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-textPrimary/16 text-textSecondary transition hover:border-textPrimary/25"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.5 8.5 0 0 1-4-1L3 20l1-3.5A8.5 8.5 0 1 1 21 11.5z" />
          </svg>
        </Link>
      </div>

      {moreCount > 0 ? (
        <Link
          href="/client/bookings"
          className="mt-3 block text-center font-display text-[12.5px] font-semibold text-textMuted transition hover:text-textSecondary"
        >
          {moreCount} more upcoming →
        </Link>
      ) : null}
    </div>
  )
}
