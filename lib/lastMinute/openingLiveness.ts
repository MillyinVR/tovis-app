// lib/lastMinute/openingLiveness.ts
//
// Turns a stored LastMinuteOpening into the candidate the read-time schedule
// gate takes (`lib/booking/storedSlotLiveness.ts`).
//
// Four client-facing surfaces show the same stored opening — the openings feed,
// the priority-offer list, the client home invites and the claim page itself —
// and all four have to ask the schedule the SAME question, or one of them keeps
// advertising a slot the others have hidden.
//
// The answers baked in here, once:
//
// - `commitGate: 'CLIENT_HOLD'`. An opening is claimed through the client hold
//   path (`POST /holds` → `evaluateHoldCreationDecision`), which makes an
//   off-grid start fatal and drops the claiming client's own plain holds first.
//   `createLastMinuteOpening` enforces the same step rule at write time, so that
//   half only ever fires when the pro RE-anchors their grid after publishing.
// - `releasedHoldId: null`. An opening reserves nothing — it advertises free
//   time rather than holding it, which is why it can be lost to an ordinary
//   booking at all.

import { ServiceLocationType } from '@prisma/client'

import type { StoredSlotCandidate } from '@/lib/booking/storedSlotLiveness'
import { resolveOpeningWindowMinutes } from '@/lib/lastMinute/openingDuration'

export type OpeningLivenessServiceRow = {
  service: { defaultDurationMinutes: number | null }
  offering: {
    salonDurationMinutes: number | null
    mobileDurationMinutes: number | null
  }
}

export type OpeningLivenessRow = {
  id: string
  professionalId: string
  startAt: Date
  locationId: string | null
  locationType: ServiceLocationType
  professional: { timeZone: string | null }
  services: readonly OpeningLivenessServiceRow[]
}

/**
 * Null when the opening carries no active service — nothing to price a window
 * from, and nothing a claim could book either.
 */
export function openingLivenessCandidate(
  opening: OpeningLivenessRow,
): StoredSlotCandidate | null {
  const durationMinutes = resolveOpeningWindowMinutes(
    opening.services.map((row) => ({
      salonDurationMinutes: row.offering.salonDurationMinutes,
      mobileDurationMinutes: row.offering.mobileDurationMinutes,
      defaultDurationMinutes: row.service.defaultDurationMinutes,
    })),
    opening.locationType,
  )

  if (durationMinutes == null) return null

  return {
    key: opening.id,
    professionalId: opening.professionalId,
    professionalTimeZone: opening.professional.timeZone ?? null,
    locationId: opening.locationId,
    locationType: opening.locationType,
    startUtc: opening.startAt,
    durationMinutes,
    commitGate: 'CLIENT_HOLD',
    releasedHoldId: null,
  }
}
