// lib/booking/rebookWidth.ts

import { Prisma, ServiceLocationType } from '@prisma/client'

import { MAX_SLOT_DURATION_MINUTES } from '@/lib/booking/constants'
import { normalizePositiveDurationMinutes } from '@/lib/booking/serviceItems'
import { clampInt } from '@/lib/pick'

/**
 * The floor a clone's width is clamped to — same number the rebook commit
 * clamps with (`performLockedCreateRebookedBooking`).
 */
const MIN_REBOOK_DURATION_MINUTES = 15

/**
 * The fields an aftercare rebook's committed width is derived from. Structural
 * (not a Prisma payload) for the same reason as `RescheduleTargetRecord`: the
 * commit site holds the full source row, the availability site selects only
 * these columns.
 */
export type RebookSourceWidthRecord = {
  totalDurationMinutes: number | null
  serviceItems: { durationMinutesSnapshot: number | null }[]
}

/**
 * THE width an aftercare rebook will COMMIT for a same-mode next appointment.
 *
 * `performLockedCreateRebookedBooking` clones the SOURCE booking's service
 * items — base plus add-ons, at their snapshot durations — so the appointment
 * it creates is as wide as the original, not as wide as the offering's base.
 * Sizing the offer (day slots, open-slot counts) from the offering alone
 * therefore advertises starts the clone doesn't fit; this function is the one
 * number both sides use ([[promise-site-runs-the-commit-site-gate]],
 * [[offer-reserve-commit-are-three-windows]]).
 *
 * It intentionally mirrors the commit's fallbacks: a snapshot-less item counts
 * as 60 minutes, and an item-less booking falls back to the row's own
 * `totalDurationMinutes` (the commit refuses item-less bookings outright, so
 * that fallback only ever sizes an offer whose save will be refused anyway).
 *
 * Lives here rather than in `writeBoundary` because the OFFER is a read path —
 * availability must be able to ask what the commit will take without importing
 * the write boundary.
 */
export function computeRebookCloneDurationMinutes(
  source: RebookSourceWidthRecord,
): number {
  const totalFromItems = source.serviceItems.reduce(
    (sum, item) =>
      sum + (normalizePositiveDurationMinutes(item.durationMinutesSnapshot) ?? 60),
    0,
  )

  if (totalFromItems > 0) {
    return clampInt(
      totalFromItems,
      MIN_REBOOK_DURATION_MINUTES,
      MAX_SLOT_DURATION_MINUTES,
    )
  }

  return normalizePositiveDurationMinutes(source.totalDurationMinutes) ?? 60
}

/**
 * The columns the availability site reads for a rebook-width lookup: the width
 * inputs above, plus ownership (client/pro), the source's location mode (a
 * mode-switched rebook re-derives from the live offering instead of cloning),
 * and the item count backing the commit's single-item-only rule for mode
 * switches.
 */
export const REBOOK_SOURCE_WIDTH_SELECT = {
  clientId: true,
  professionalId: true,
  locationType: true,
  totalDurationMinutes: true,
  serviceItems: {
    orderBy: { sortOrder: 'asc' },
    select: { durationMinutesSnapshot: true },
  },
} satisfies Prisma.BookingSelect

export type RebookSourceWidthRow = {
  clientId: string
  professionalId: string
  locationType: ServiceLocationType
} & RebookSourceWidthRecord
