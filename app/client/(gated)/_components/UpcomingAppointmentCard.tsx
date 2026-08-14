// app/client/(gated)/_components/UpcomingAppointmentCard.tsx
import Link from 'next/link'

import { asTrimmedString } from '@/lib/guards'
import { Avatar, Card, buttonClassName } from '@/app/_components/ui'
import ProProfileLink from '@/app/_components/ProProfileLink'

import type { ClientHomeBooking } from '../_data/getClientHomeData'
import { bookingTitle } from './bookingDisplay'
import {
  formatDateTime,
  formatDuration,
  money,
  professionalName,
} from './homeVisuals'

/**
 * Where the pro works, under their name — the frame's "Halo Studio · Brooklyn".
 * The studio and the city are BOTH shown when both exist: the name alone says
 * nothing to a client deciding whether this is the salon near them, and the city
 * alone loses the name they booked. Falls back down the chain when there is no
 * location row to read.
 */
function bookingLocation(booking: ClientHomeBooking): string | null {
  const parts = [booking.location?.name, booking.location?.city]
    .map((part) => part?.trim() || null)
    .filter((part): part is string => part !== null)

  if (parts.length > 0) return parts.join(' · ')

  return (
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

/**
 * The client's route to their own appointments list. It lives on Home rather
 * than in the footer (see CLIENT_TABS), and it is UNCONDITIONAL on purpose:
 * /client/bookings is the only surface listing PENDING bookings, so a client
 * whose single booking is still awaiting approval — who therefore sees the empty
 * card below, not the populated one — must still be able to open, and cancel,
 * their own request. Rendered by BOTH states for exactly that reason.
 */
function AllBookingsLink({ moreCount = 0 }: { moreCount?: number }) {
  return (
    <Link
      href="/client/bookings"
      className="mt-3 block text-center font-display text-[12.5px] font-semibold text-textMuted transition hover:text-textSecondary"
    >
      {moreCount > 0 ? `${moreCount} more upcoming →` : 'All bookings →'}
    </Link>
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
        href="/search"
        className={buttonClassName({
          variant: 'ghost',
          size: 'sm',
          shape: 'soft',
          className: 'mt-3.5 hover:border-terra/30 hover:text-terra',
        })}
      >
        Find a pro
      </Link>
      <AllBookingsLink />
    </Card>
  )
}

export default function UpcomingAppointmentCard({
  booking,
  upcomingCount = 0,
  proRating = null,
}: {
  booking: ClientHomeBooking | null
  upcomingCount?: number
  /** Null when the pro has no visible reviews — no star, rather than "0.0★". */
  proRating?: { average: number; count: number } | null
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
        <ProProfileLink
          proId={booking.professional.id}
          label={proName}
          underline={false}
          className="shrink-0 rounded-full transition hover:opacity-80"
        >
          <Avatar
            name={proName}
            src={booking.professional.avatarUrl}
            size="lg"
          />
        </ProProfileLink>
        <div className="min-w-0">
          <ProProfileLink
            proId={booking.professional.id}
            label={proName}
            underline={false}
            className="block truncate font-display text-[17px] font-semibold tracking-[-0.01em] text-textPrimary transition hover:opacity-80"
          />
          {location || proRating ? (
            <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-textMuted">
              {location ? <span className="truncate">{location}</span> : null}
              {location && proRating ? <span aria-hidden>·</span> : null}
              {proRating ? (
                <span className="shrink-0 whitespace-nowrap text-textSecondary">
                  {proRating.average.toFixed(1)}
                  <span aria-hidden>★</span>
                  <span className="sr-only">
                    {' '}
                    out of 5, from {proRating.count}{' '}
                    {proRating.count === 1 ? 'review' : 'reviews'}
                  </span>
                </span>
              ) : null}
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
        {/*
          Resolves (or opens) the booking's own message thread and lands in it.
          It used to point at `/client/bookings/{id}?action=message` — a param
          the booking page does not read, on a page that has no messaging
          affordance at all, so "message your pro" dead-ended on the booking
          overview. `/messages/start` is the resolver the rest of the app uses.
        */}
        <Link
          href={`/messages/start?kind=BOOKING&bookingId=${encodeURIComponent(booking.id)}`}
          aria-label={`Message ${proName}`}
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

      <AllBookingsLink moreCount={moreCount} />
    </Card>
  )
}
