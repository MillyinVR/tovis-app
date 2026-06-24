// app/pro/aftercare/page.tsx
import { redirect } from 'next/navigation'
import { BookingStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { requirePro } from '@/app/api/_utils/auth/requirePro'
import { loadBookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'
import {
  DEFAULT_TIME_ZONE,
  resolveApptTimeZoneFromValues,
} from '@/lib/time'
import {
  deriveProAftercareCard,
  type ProAftercareRowInput,
} from '@/lib/aftercare/proAftercareList'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'

import AftercareListClient, {
  type ProAftercareListItem,
} from './AftercareListClient'

export const dynamic = 'force-dynamic'

// A confirmed next booking (loop closed) is any rebook child that is no longer
// just a pending proposal — i.e. accepted, in progress, or completed.
const CONFIRMED_NEXT_STATUSES: BookingStatus[] = [
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
]

export default async function ProAftercarePage() {
  const auth = await requirePro()

  if (!auth.ok) {
    redirect(`/login?from=${encodeURIComponent('/pro/aftercare')}`)
  }

  const professionalId = auth.professionalId
  // Fallback only — the appointment's own location timezone wins per row below,
  // so timestamps read correctly even when the pro travels outside home base.
  const professionalTimeZone = auth.user.professionalProfile?.timeZone

  const rows = await prisma.aftercareSummary.findMany({
    where: {
      booking: {
        is: {
          professionalId,
        },
      },
    },
    orderBy: [{ sentToClientAt: 'desc' }, { draftSavedAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      bookingId: true,
      createdAt: true,
      draftSavedAt: true,
      sentToClientAt: true,
      rebookMode: true,
      rebookedFor: true,
      rebookWindowStart: true,
      rebookWindowEnd: true,
      booking: {
        select: {
          id: true,
          scheduledFor: true,
          locationTimeZone: true,
          service: {
            select: {
              name: true,
            },
          },
          client: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
          // The confirmed next booking off this aftercare (if any) closes the
          // loop → status "finished" + the actual booked date.
          rebooks: {
            where: { status: { in: CONFIRMED_NEXT_STATUSES } },
            orderBy: { scheduledFor: 'asc' },
            take: 1,
            select: {
              scheduledFor: true,
              createdAt: true,
            },
          },
        },
      },
    },
  })

  // Before/after photos are the primary way a pro recognizes an aftercare they
  // sent — load them for every listed booking so each card leads with them.
  const beforeAfterByBooking = await loadBookingBeforeAfterThumbs(
    rows.map((row) => row.bookingId),
  )

  const items: ProAftercareListItem[] = rows.map((row) => {
    // Appointment location timezone wins (pro timezone as fallback) so these
    // read in the zone where the appointment actually happened.
    const tzResult = resolveApptTimeZoneFromValues({
      bookingLocationTimeZone: row.booking.locationTimeZone,
      professionalTimeZone,
      fallback: DEFAULT_TIME_ZONE,
    })
    const timeZone = tzResult.ok ? tzResult.timeZone : DEFAULT_TIME_ZONE

    const confirmed = row.booking.rebooks[0] ?? null

    const input: ProAftercareRowInput = {
      id: row.id,
      bookingId: row.bookingId,
      createdAt: row.createdAt,
      draftSavedAt: row.draftSavedAt,
      sentToClientAt: row.sentToClientAt,
      rebookMode: row.rebookMode,
      rebookedFor: row.rebookedFor,
      rebookWindowStart: row.rebookWindowStart,
      rebookWindowEnd: row.rebookWindowEnd,
      scheduledFor: row.booking.scheduledFor,
      serviceName: row.booking.service?.name ?? null,
      clientName: formatClientName(row.booking.client),
      timeZone,
      nextBooking: confirmed
        ? { scheduledFor: confirmed.scheduledFor, bookedAt: confirmed.createdAt }
        : null,
    }

    return {
      ...deriveProAftercareCard(input),
      media: beforeAfterByBooking.get(row.bookingId) ?? null,
    }
  })

  return <AftercareListClient items={items} />
}
