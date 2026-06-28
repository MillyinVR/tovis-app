// lib/live/broadcastBooking.ts
//
// Convenience over broadcastLive() for the common case: "this booking changed,
// tell its pro + client". Resolves both channels from the bookingId in one
// query, so call sites that only have a bookingId stay one line. Fail-open.
import 'server-only'

import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import {
  broadcastLive,
  liveChannelForPro,
  liveChannelForUser,
  type LiveTopic,
} from './broadcast'

/**
 * Notify a booking's pro (salon) + client (their devices) that it changed.
 * Fully fail-safe: an unresolved/missing booking or any lookup error is
 * swallowed, so a live-sync miss never affects the write that already committed.
 */
export async function broadcastBookingChange(
  bookingId: string,
  topic: LiveTopic,
): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        professionalId: true,
        client: { select: { userId: true } },
      },
    })

    if (!booking) return

    await broadcastLive(
      [
        liveChannelForPro(booking.professionalId),
        liveChannelForUser(booking.client?.userId ?? null),
      ],
      topic,
    )
  } catch (error: unknown) {
    console.warn('broadcastBookingChange failed', { error: safeError(error) })
  }
}
