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
import type { ClientAftercareInboxItemDTO } from '@/lib/dto/clientAftercareInbox'
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from '@/lib/booking/statusLabel'
import { COPY } from '@/lib/copy'
import { Avatar, Badge, Card, CardLinkOverlay } from '@/app/_components/ui'
import ProProfileLink from '@/app/_components/ProProfileLink'

import {
  formatDateTime,
  formatDuration,
  professionalName,
} from '../_components/homeVisuals'

/**
 * How many aftercare summaries the strip shows before deferring to the full
 * inbox. The page fetches one MORE than this so it can tell "that's all of them"
 * from "there are others" without a second count query.
 */
export const AFTERCARE_STRIP_SIZE = 3

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
  const proId = booking.professional?.id ?? null

  // The row still opens the booking, but as a full-bleed overlay rather than a
  // wrapping <Link> — so the pro's avatar and name can be their own links to the
  // pro's profile without nesting anchors (which would kill the inner click).
  return (
    <Card
      padding="sm"
      className="relative transition hover:border-textPrimary/20"
    >
      <CardLinkOverlay
        href={`/client/bookings/${encodeURIComponent(booking.id)}`}
        label={`${booking.display.title} with ${proName}, ${when}`}
      />

      <div className="pointer-events-none relative z-10 flex items-center gap-3">
        <ProProfileLink
          proId={proId}
          label={proName}
          underline={false}
          className="pointer-events-auto shrink-0 rounded-full"
        >
          <Avatar name={proName} size="md" />
        </ProProfileLink>

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
            <ProProfileLink
              proId={proId}
              label={proName}
              className="pointer-events-auto"
            />
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
  )
}

function WaitlistRow({ entry }: { entry: ClientBookingWaitlistRow }) {
  const proName = entry.professional
    ? professionalName(entry.professional)
    : 'Professional'

  const proId = entry.professional?.id ?? null

  return (
    <Card padding="sm">
      <div className="flex items-center gap-3">
        <ProProfileLink
          proId={proId}
          label={proName}
          underline={false}
          className="shrink-0 rounded-full"
        >
          <Avatar name={proName} size="md" />
        </ProProfileLink>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-textPrimary">
            {entry.service?.name ?? 'Any service'}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-textSecondary">
            <ProProfileLink proId={proId} label={proName} />
          </div>
        </div>
        <Badge tone="info" size="sm">
          Waitlisted
        </Badge>
      </div>
    </Card>
  )
}

function AftercareRow({ item }: { item: ClientAftercareInboxItemDTO }) {
  const when = item.scheduledFor
    ? formatDateTime(new Date(item.scheduledFor), item.timeZone)
    : null

  // A summary whose notification lost its booking link can't deep-link to the
  // visit's aftercare step, so it falls back to the inbox rather than to a
  // /client/bookings/null 404.
  const href = item.bookingId
    ? `/client/bookings/${encodeURIComponent(item.bookingId)}?step=aftercare`
    : '/client/aftercare'

  return (
    <Card padding="sm" className="relative transition hover:border-textPrimary/20">
      <CardLinkOverlay
        href={href}
        label={`Aftercare for ${item.title} with ${item.proName}`}
      />

      <div className="pointer-events-none relative z-10 flex items-center gap-3">
        <ProProfileLink
          proId={item.proId}
          label={item.proName}
          underline={false}
          className="pointer-events-auto shrink-0 rounded-full"
        >
          <Avatar name={item.proName} size="md" />
        </ProProfileLink>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold text-textPrimary">
            {item.title}
          </div>
          {when ? (
            <div className="mt-0.5 truncate text-[12.5px] text-textSecondary">
              {when}
            </div>
          ) : null}
          <div className="mt-0.5 truncate text-[12px] text-textMuted">
            <ProProfileLink
              proId={item.proId}
              label={item.proName}
              className="pointer-events-auto"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {item.unread ? (
            <Badge tone="info" size="sm">
              {COPY.aftercareInbox.newPill}
            </Badge>
          ) : null}
          <ChevronRight />
        </div>
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
  count: number | null
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-textPrimary">
          {title}
        </h2>
        {count === null ? null : (
          <span className="font-mono text-[11px] tabular-nums text-textMuted">
            {count}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export default function AppointmentsList({
  buckets,
  aftercare = [],
  hasMoreAftercare = false,
}: {
  buckets: ClientBookingBuckets
  aftercare?: ClientAftercareInboxItemDTO[]
  hasMoreAftercare?: boolean
}) {
  // Aftercare counts toward "is there anything here". A summary outliving its
  // booking row would otherwise be hidden behind the "No appointments yet" card.
  const isEmpty =
    buckets.upcoming.length === 0 &&
    buckets.pending.length === 0 &&
    buckets.prebooked.length === 0 &&
    buckets.waitlist.length === 0 &&
    buckets.past.length === 0 &&
    aftercare.length === 0

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
            href="/search"
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

          {/* count={null} on purpose: the other sections show a complete bucket,
              so their number IS the total. This one is a capped strip, where a
              "3" would read as "you have three" when there may be thirty. */}
          {aftercare.length > 0 ? (
            <Section title={COPY.aftercareInbox.title} count={null}>
              {aftercare.map((item) => (
                <AftercareRow key={item.notificationId} item={item} />
              ))}

              {/* No silent truncation: the strip caps at AFTERCARE_STRIP_SIZE, so
                  when more exist say so and hand off to the full inbox. */}
              {hasMoreAftercare ? (
                <Link
                  href="/client/aftercare"
                  className="self-start font-display text-[13px] font-semibold text-accentPrimary transition hover:opacity-80"
                >
                  All aftercare →
                </Link>
              ) : null}
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
