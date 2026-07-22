// lib/waitlist/offerLiveness.ts
//
// Turns a stored WaitlistOffer into the candidate the read-time schedule gate
// takes (`lib/booking/storedSlotLiveness.ts`).
//
// The two answers baked in here, once, because both are silently wrong in both
// directions:
//
// - `commitGate: 'PRO_CREATE'`. The confirm books through
//   `performLockedCreateProBooking`, which does not enforce the slot grid — the
//   PRO picked this minute and is allowed any minute (F4) — and does not sweep
//   the client's own holds, so one really would refuse this confirm.
// - `releasedHoldId` is the offer's OWN reservation (F14). The confirm deletes
//   that hold before it books — it would otherwise refuse the very booking the
//   hold exists to protect — so counting it as an obstacle would make every
//   offer hide itself the moment it was made. Null for offers written before
//   F14, which reserved nothing.

import { ServiceLocationType } from '@prisma/client'

import type { StoredSlotCandidate } from '@/lib/booking/storedSlotLiveness'

export type WaitlistOfferLivenessRow = {
  id: string
  professionalId: string
  professional: { timeZone: string | null }
  locationId: string
  locationType: ServiceLocationType
  startsAt: Date
  durationMinutes: number
  hold: { id: string } | null
}

export function waitlistOfferLivenessCandidate(
  offer: WaitlistOfferLivenessRow,
): StoredSlotCandidate {
  return {
    key: offer.id,
    professionalId: offer.professionalId,
    professionalTimeZone: offer.professional.timeZone ?? null,
    locationId: offer.locationId,
    locationType: offer.locationType,
    startUtc: offer.startsAt,
    durationMinutes: offer.durationMinutes,
    commitGate: 'PRO_CREATE',
    releasedHoldId: offer.hold?.id ?? null,
  }
}
