// lib/booking/addOnsContext.ts
//
// What the add-ons step carries over from the booking sheet: the look, the pro,
// the time you picked, and how long the hold has left.
//
// The design's own note for this screen is "carries context — the look, pro,
// time and hold timer follow you from the sheet, so it never feels like a new
// screen". Before this, arriving at add-ons dropped all four: you chose upgrades
// for an appointment the page never named.
import { prisma } from '@/lib/prisma'
import { formatInTimeZone } from '@/lib/time'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'
import { loadBookingCover, type BookingCover } from '@/lib/booking/bookingCover'

export type AddOnsContext = {
  cover: BookingCover | null
  proName: string | null
  /** "Thu, Jun 15 · 2:30 PM", already in the APPOINTMENT's zone. */
  whenLabel: string | null
  /** ISO instant the hold lapses, so the client can tick it down itself. */
  holdExpiresAt: string | null
}

/**
 * Everything is best-effort and independently nullable: this strip is context,
 * not a gate. A missing piece hides that piece rather than blocking the step or
 * throwing — the hold itself is what the finalize call validates.
 */
export async function loadAddOnsContext(args: {
  holdId: string | null
  mediaId: string | null
}): Promise<AddOnsContext> {
  const holdId = args.holdId?.trim() || null

  const [cover, hold] = await Promise.all([
    loadBookingCover(args.mediaId),
    holdId
      ? prisma.bookingHold.findUnique({
          where: { id: holdId },
          select: {
            scheduledFor: true,
            expiresAt: true,
            locationTimeZone: true,
            // The approved fragment rather than naming the plaintext columns:
            // what a pro is publicly called is a privacy decision, and
            // `lib/privacy` owns both the select and the formatter.
            professional: { select: professionalPublicDisplayNameSelect },
          },
        })
      : null,
  ])

  if (!hold) {
    return { cover, proName: null, whenLabel: null, holdExpiresAt: null }
  }

  // 🔴 The appointment's own zone, never the server's — on Vercel that is UTC,
  // which would show a 2:30 PM booking as 6:30 PM. `lib/time` is the only route
  // to a formatted instant in this repo for exactly that reason.
  const timeZone = hold.locationTimeZone?.trim() || null

  return {
    cover,
    proName: hold.professional
      ? formatProfessionalPublicDisplayName(hold.professional)
      : null,
    whenLabel: timeZone
      ? formatInTimeZone(hold.scheduledFor, timeZone, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null,
    holdExpiresAt: hold.expiresAt.toISOString(),
  }
}
