// app/client/(gated)/_components/UpcomingAppointmentCard.tsx
import Link from 'next/link'

import { asTrimmedString } from '@/lib/guards'
import { Avatar, Card, buttonClassName } from '@/app/_components/ui'

import type { ClientHomeBooking } from '../_data/getClientHomeData'
import { bookingTitle } from './bookingDisplay'
import {
  formatDateTime,
  formatDuration,
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
    <Card>
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
        className={buttonClassName({
          variant: 'ghost',
          size: 'sm',
          shape: 'soft',
          className: 'mt-3.5 hover:border-terra/30 hover:text-terra',
        })}
      >
        Find a pro
      </Link>
    </Card>
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
    <Card>
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
        <Avatar
          name={proName}
          src={booking.professional.avatarUrl}
          size="lg"
        />
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
          className={buttonClassName({
            variant: 'primary',
            size: 'md',
            shape: 'soft',
            className: 'flex-1',
          })}
        >
          View booking
        </Link>
        <Link
          href={`/client/bookings/${encodeURIComponent(booking.id)}?action=message`}
          aria-label="Message pro"
          className={buttonClassName({
            variant: 'ghost',
            size: 'md',
            shape: 'soft',
            className: 'w-11 shrink-0 px-0',
          })}
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
    </Card>
  )
}
