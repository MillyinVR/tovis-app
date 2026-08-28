// app/pro/clients/[id]/VisitHistoryList.tsx
//
// The chart's unified per-visit card.
//
// This was TWO tabs — "History" (a row per booking) and "Photos" (a grid per
// booking) — which were two groupings of the same visits, so a pro comparing a
// formula against the result had to hold one tab in their head while reading the
// other. `history[].photos` (#1017) is the shape that merged them.
//
// Presentational only: the page owns every query, and hands the photos in as a
// bookingId → frames map so this file cannot grow a per-booking read.
import Link from 'next/link'

import RemoteImage from '@/app/_components/media/RemoteImage'
import RelationshipBadgePill from '@/app/_components/RelationshipBadgePill'
import { Badge } from '@/app/_components/ui'
import {
  badgeToneForBookingStatus,
  labelForBookingStatus,
} from '@/lib/booking/statusLabel'
import { resolveAppointmentDisplayTimeZone } from '@/lib/booking/appointmentDisplayTimeZone'
import type { ChartVisitRow } from '@/lib/clients/chartVisitFilters'
import { moneyToString } from '@/lib/money'
import { pickString } from '@/lib/pick'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'
import { formatDateShortInTimeZone } from '@/lib/time'

/** One rendered frame. `imageUrl` is resolved (signed or public) by the loader. */
export type VisitPhoto = {
  id: string
  phase: string
  caption: string | null
  imageUrl: string
}

/** bookingId → that visit's frames, BEFORE-first. */
export type VisitPhotosByBooking = ReadonlyMap<string, VisitPhoto[]>

/**
 * A booking's state in the client's visit history.
 *
 * Found by `check:booking-status-labels`, not by hand (B10): this rendered the
 * RAW ENUM — "ACCEPTED", and for the two states its own tone map had never
 * heard of, "IN_PROGRESS" and "NO_SHOW" in a neutral grey chip.
 */
function StatusPill({ status }: { status: unknown }) {
  const normalizedStatus = pickString(status)?.toUpperCase() ?? ''

  if (!normalizedStatus) return <Badge tone="neutral">Unknown</Badge>

  return (
    <Badge tone={badgeToneForBookingStatus(normalizedStatus)}>
      {labelForBookingStatus(normalizedStatus)}
    </Badge>
  )
}

// A visit's before/after frames, inline on the card for that visit. Rendered
// only when the visit HAS frames this pro may see — an empty grid or a
// "no photos" placeholder on every photo-less visit is noise on a list where
// most rows have none.
function VisitPhotoGrid({ photos }: { photos: VisitPhoto[] }) {
  return (
    <div className="mt-3 border-t border-surfaceGlass/10 pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo) => (
          <div
            key={photo.id}
            className="relative aspect-square overflow-hidden rounded-card border border-surfaceGlass/10 bg-bgSecondary"
          >
            <RemoteImage
              src={photo.imageUrl}
              alt={photo.caption ?? `${photo.phase} photo`}
              className="h-full w-full object-cover"
              loading="lazy"
              width={240}
              height={240}
            />
            <span className="absolute left-1 top-1">
              <Badge tone="neutral" size="sm">
                {photo.phase}
              </Badge>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// One card per visit: the booking's own facts AND its before/after frames.
export default function VisitHistoryList({
  bookingRowsFiltered,
  bookingRowsAll,
  photosByBooking,
  proId,
  tz,
}: {
  bookingRowsFiltered: ChartVisitRow[]
  bookingRowsAll: ChartVisitRow[]
  photosByBooking: VisitPhotosByBooking
  proId: string
  tz: string
}) {
  if (bookingRowsFiltered.length === 0) {
    return (
      <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 text-[12px] font-semibold text-textSecondary">
        No visits match your search/filter.
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="text-[11px] font-semibold text-textSecondary">
        Showing{' '}
        <span className="font-black text-textPrimary">
          {bookingRowsFiltered.length}
        </span>{' '}
        of{' '}
        <span className="font-black text-textPrimary">
          {bookingRowsAll.length}
        </span>
      </div>

      {bookingRowsFiltered.map((booking) => {
        const durationMinutes = Math.round(
          Number(booking.totalDurationMinutes ?? 0),
        )
        const total =
          moneyToString(booking.totalAmount ?? booking.subtotalSnapshot) ??
          '0.00'
        const when = formatDateShortInTimeZone(
          booking.scheduledFor,
          resolveAppointmentDisplayTimeZone(booking.locationTimeZone, tz),
        )
        const proName = formatPublicProfileDisplayName({
          businessName: booking.professional?.businessName,
          firstName: booking.professional?.firstName,
          lastName: booking.professional?.lastName,
          fallback: 'Professional',
        })
        const isMine = booking.professionalId === proId
        const photos = photosByBooking.get(booking.id) ?? []

        return (
          <Link
            key={booking.id}
            href={`/pro/bookings/${encodeURIComponent(booking.id)}`}
            className="block rounded-card border border-surfaceGlass/10 bg-bgPrimary p-4 hover:bg-surfaceGlass/10"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-[13px] font-black text-textPrimary">
                    {booking.service?.name ?? 'Service'}
                  </div>

                  <StatusPill status={booking.status} />

                  {/* K5 mark, ONLY on the viewing pro's own rows: it answers
                      "did this client request ME, and had I seen them before?",
                      so on another pro's booking it would misread. */}
                  {isMine ? <RelationshipBadgePill booking={booking} /> : null}
                </div>

                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  {booking.service?.category?.name
                    ? `${booking.service.category.name} • `
                    : ''}
                  Pro:{' '}
                  <span className="font-black text-textPrimary">
                    {proName}
                  </span>
                  {isMine ? (
                    <Badge tone="neutral" size="sm" className="ml-2">
                      Me
                    </Badge>
                  ) : null}
                  {/* Why another pro's frames are visible at all: the CLIENT
                      promoted them with a public review. Without this the grid
                      on someone else's visit looks like a leak. */}
                  {!isMine && photos.length ? (
                    <Badge tone="info" size="sm" className="ml-2">
                      Client-shared
                    </Badge>
                  ) : null}
                </div>

                {booking.aftercareSummary?.notes ? (
                  <div className="mt-2 text-[12px] font-semibold text-textSecondary">
                    <span className="font-black text-textPrimary">
                      Aftercare:
                    </span>{' '}
                    {booking.aftercareSummary.notes.slice(0, 120)}
                    {booking.aftercareSummary.notes.length > 120 ? '…' : ''}
                  </div>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[12px] font-semibold text-textSecondary">
                  {when}
                </div>

                <div className="mt-1 text-[12px] font-black text-textPrimary">
                  {durationMinutes ? `${durationMinutes} min` : '—'} • ${total}
                </div>
              </div>
            </div>

            {photos.length ? <VisitPhotoGrid photos={photos} /> : null}
          </Link>
        )
      })}
    </div>
  )
}
