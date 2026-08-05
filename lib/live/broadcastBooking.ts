// lib/live/broadcastBooking.ts
//
// Convenience over broadcastChange() for the common case: "this booking
// changed, tell its pro + client". Resolves the parties from the bookingId in
// one query, so call sites that only have a bookingId stay one line. Fail-open.
//
// How a party maps to channels (a pro is the salon channel PLUS their own user
// channel, so the phone hears it too) belongs to lib/live/broadcastAudience.ts —
// this module only decides WHO the parties are.
import 'server-only'

import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import { type LiveTopic } from './broadcast'
import { broadcastChange } from './broadcastAudience'

/**
 * Notify a booking's pro (their devices, web + phone) + client (their devices)
 * that it changed. Fully fail-safe: an unresolved/missing booking or any lookup
 * error is swallowed, so a live-sync miss never affects the write that already
 * committed.
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

    await broadcastChange({
      topic,
      professionalId: booking.professionalId,
      userIds: [booking.client?.userId ?? null],
    })
  } catch (error: unknown) {
    console.warn('broadcastBookingChange failed', { error: safeError(error) })
  }
}
