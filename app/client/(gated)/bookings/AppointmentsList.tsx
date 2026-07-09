// app/client/(gated)/bookings/AppointmentsList.tsx
//
// The client's standalone Appointments list — bucketed exactly like iOS
// AppointmentsView (Upcoming / Needs your attention / Pre-booked / Waitlist /
// Past), backed by the same GET /api/v1/client/bookings data (via the shared
// loadClientBookingBuckets). Web went home-centric and dropped this list; W2
// restores it. Each booking taps through to /client/bookings/[id].
import Link from 'next/link'

import type { ClientBookingDTO } from '@/lib/dto/clientBooking'
import type {
  ClientBookingBuckets,
  ClientBookingWaitlistRow,
} from '@/lib/booking/clientBookingBuckets'
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from '@/lib/booking/statusLabel'
import { Avatar, Badge, Card } from '@/app/_components/ui'

import {
  formatDateTime,
  formatDuration,
  professionalName,
} from '../_components/homeVisuals'

function ChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-textMuted"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function BookingRow({ booking }: { booking: ClientBookingDTO }) {
  const proName = booking.professional
    ? professionalName(booking.professional)
    : 'Professional'
  const timeZone = booking.timeZone ?? booking.professional?.timeZone ?? null
  const when = formatDateTime(new Date(booking.scheduledFor), timeZone)
  const duration = formatDuration(booking.totalDurationMinutes)
  const status = String(booking.status ?? '')

  return (
    <Link
      href={`/client/bookings/${encodeURIComponent(booking.id)}`}
      className="block rounded-card outline-none transition focus-visible:ring-2 focus-visible:ring-accentPrimary/40"
    >
      <Card padding="sm" className="transition hover:border-textPrimary/20">
        <div className="flex items-center gap-3">
          <Avatar name={proName} size="md" />

          <div className="min-w-0 flex-1">
            <div className="truncate text-[14.5px] font-semibold text-textPrimary">
              {booking.display.title}
            </div>
            <div className="mt-0.5 truncate text-[12.5px] text-textSecondary">
              {when}
              {duration ? (
                <span className="text-textMuted"> · {duration}</span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[12px] text-textMuted">
              {proName}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {booking.hasUnreadAftercare ? (
              <span
                className="h-2 w-2 rounded-full bg-accentPrimary"
                aria-label="Aftercare ready"
              />
            ) : null}
            {booking.hasPendingConsultationApproval ? (
              <Badge tone="warn" size="sm">
                Review
              </Badge>
            ) : status ? (
              <Badge tone={badgeToneForBookingStatus(status)} size="sm">
                {labelForBookingStatus(status)}
              </Badge>
            ) : null}
            <ChevronRight />
          </div>
        </div>
      </Card>
    </Link>
  )
}

function WaitlistRow({ entry }: { entry: ClientBookingWaitlistRow }) {
  const proName = entry.professional
    ? professionalName(entry.professional)
    : 'Professional'

  return (
    <Card padding="sm">
      <div className="flex items-center gap-3">
        <Avatar name={proName} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-textPrimary">
            {entry.service?.name ?? 'Any service'}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-textSecondary">
            {proName}
          </div>
        </div>
        <Badge tone="info" size="sm">
          Waitlisted
        </Badge>
      </div>
    </Card>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-textPrimary">
          {title}
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-textMuted">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export default function AppointmentsList({
  buckets,
}: {
  buckets: ClientBookingBuckets
}) {
  const isEmpty =
    buckets.upcoming.length === 0 &&
    buckets.pending.length === 0 &&
    buckets.prebooked.length === 0 &&
    buckets.waitlist.length === 0 &&
    buckets.past.length === 0

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 pb-16 pt-2">
      <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-textPrimary">
        Appointments
      </h1>

      {isEmpty ? (
        <Card className="text-center">
          <p className="text-[15px] font-semibold text-textPrimary">
            No appointments yet
          </p>
          <p className="mt-1.5 text-[13px] text-textMuted">
            Once you book, your appointments show up here.
          </p>
          <Link
            href="/discover"
            className="mt-4 inline-block font-display text-[13px] font-semibold text-accentPrimary transition hover:opacity-80"
          >
            Find a pro →
          </Link>
        </Card>
      ) : (
        <>
          {buckets.upcoming.length > 0 ? (
            <Section title="Upcoming" count={buckets.upcoming.length}>
              {buckets.upcoming.map((booking) => (
                <BookingRow key={booking.id} booking={booking} />
              ))}
            </Section>
          ) : null}

          {buckets.pending.length > 0 ? (
            <Section
              title="Needs your attention"
              count={buckets.pending.length}
            >
              {buckets.pending.map((booking) => (
                <BookingRow key={booking.id} booking={booking} />
              ))}
            </Section>
          ) : null}

          {buckets.prebooked.length > 0 ? (
            <Section title="Pre-booked" count={buckets.prebooked.length}>
              {buckets.prebooked.map((booking) => (
                <BookingRow key={booking.id} booking={booking} />
              ))}
            </Section>
          ) : null}

          {buckets.waitlist.length > 0 ? (
            <Section title="Waitlist" count={buckets.waitlist.length}>
              {buckets.waitlist.map((entry) => (
                <WaitlistRow key={entry.id} entry={entry} />
              ))}
            </Section>
          ) : null}

          {buckets.past.length > 0 ? (
            <Section title="Past" count={buckets.past.length}>
              {buckets.past.map((booking) => (
                <BookingRow key={booking.id} booking={booking} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  )
}
