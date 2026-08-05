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

import { Prisma, ServiceLocationType, WaitlistOfferStatus } from '@prisma/client'

import type { StoredSlotCandidate } from '@/lib/booking/storedSlotLiveness'

/**
 * Has this offer's own countdown run out?
 *
 * `expiresAt: null` is NOT expired — offers written before F14 carry no expiry
 * and never lapse. That null case is the whole reason this is a named predicate
 * rather than a `<=` at each call site: the two obvious spellings of "expired"
 * (`expiresAt <= now`, `!(expiresAt > now)`) disagree on null, and one of them
 * would quietly expire every legacy offer the first time the sweep ran.
 */
export function isWaitlistOfferLapsed(
  offer: { expiresAt: Date | null },
  now: Date,
): boolean {
  return offer.expiresAt !== null && offer.expiresAt.getTime() <= now.getTime()
}

/**
 * A confirmable offer: PENDING and not past its own `expiresAt`. This is the
 * read-side twin of `assertConfirmableWaitlistOffer` — the client's offer feed
 * and the pro's waitlist both filter with it, so a card only appears while the
 * confirm would actually succeed.
 */
export function liveWaitlistOfferWhere(now: Date): Prisma.WaitlistOfferWhereInput {
  return {
    status: WaitlistOfferStatus.PENDING,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

/**
 * The exact complement of `liveWaitlistOfferWhere` within PENDING: still
 * outstanding, but past its countdown. This is what the expiry sweep claims.
 *
 * Written as the complement on purpose. A row must be either live or lapsed and
 * never both — an offer the readers still show while the sweep is expiring it is
 * a Confirm button that races a state change — and keeping the two predicates
 * adjacent is what makes that checkable.
 */
export function lapsedWaitlistOfferWhere(
  now: Date,
): Prisma.WaitlistOfferWhereInput {
  return {
    status: WaitlistOfferStatus.PENDING,
    expiresAt: { not: null, lte: now },
  }
}

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
