// lib/booking/establishedBookingCount.ts
//
// THE count behind "has this pro seen this client before?" — one query, one
// set of where-terms, for every surface that asks.
//
// It lived inline in `resolveDiscoveryFinalize`'s Promise.all, where it feeds
// both the platform-fee gate and the NR/NNR/RR/RNR mark stamped onto the
// booking. The pro's live-hold decision (B5 follow-up, Tori 2026-08-28) has to
// ask the same question about a client it is deliberately NOT allowed to name,
// so the query moved here rather than being written a second time — a second
// copy is how the popup and the badge would start disagreeing about who is new.
//
// 🔴 Not `hasEstablishedProClientRelationship` (lib/clients/proClientRelationship
// .ts). That one is an AUTHORIZATION boundary — may this pro reach this client's
// chart — and deliberately counts consent and roster signals a display label
// must not. This one answers the salon-book question the pro's own surfaces
// already show. Same English word, different question; the two are kept apart
// there for the same reason they are kept apart here.

import { BookingStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

/**
 * The statuses that ESTABLISH a (client, pro) pair. P/A/IP/COMPLETED — a booked
 * appointment counts from the moment it exists, not from when it finishes.
 *
 * 🔴 Not `BOOKING_BLOCKING_STATUSES`, which happens to hold the same four for a
 * different reason (occupancy). `lib/booking/constants.ts` says so explicitly:
 * the two must not be folded together, or a change to what blocks TIME would
 * silently change who counts as a returning CLIENT.
 */
export const ESTABLISHED_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
]

/**
 * The where-clause form, for callers that fold it into a bigger query.
 *
 * The refund-reset arm (product decision 2026-06-17) is the subtle half: a
 * CANCELLED booking still establishes the pair while its discovery fee was
 * captured and not refunded — the client paid to establish. Once the fee is
 * refunded the pair reverts to "new" and the fee re-charges on the next
 * discovery booking.
 */
export function establishedBookingWhere(args: {
  clientId: string
  professionalId: string
}): Prisma.BookingWhereInput {
  return {
    clientId: args.clientId,
    professionalId: args.professionalId,
    OR: [
      // Any non-cancelled booking = an existing relationship.
      { status: { in: [...ESTABLISHED_BOOKING_STATUSES] } },
      // Refund-reset: see above.
      {
        status: BookingStatus.CANCELLED,
        discoveryFeeAmount: { gt: 0 },
        depositPaidAt: { not: null },
        discoveryFeeRefundedAt: null,
      },
    ],
  }
}

/** How many prior bookings establish this (client, pro) pair. */
export function countEstablishedBookings(args: {
  db?: DbClient
  clientId: string
  professionalId: string
}): Promise<number> {
  return (args.db ?? prisma).booking.count({
    where: establishedBookingWhere({
      clientId: args.clientId,
      professionalId: args.professionalId,
    }),
  })
}
