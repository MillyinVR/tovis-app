// lib/waitlist/offerNotificationCopy.ts
//
// What the client is TOLD when a pro offers them a waitlist time.
//
// Split out from `createWaitlistOffer` for one reason: the sentence has to differ
// by mode, and getting that wrong is not a cosmetic bug. A mobile offer means the
// pro travels to the client's home. Announcing it with the in-salon wording —
// "{pro} has {when} open for your {service}" — invites them to confirm a home
// visit while reading a sentence about going somewhere. That is the same defect
// the offer CARD had before it started naming their address; this is the same fix
// on the notification that reaches them first.
//
// 🔴 The address is deliberately NOT here, and must not be added. This body is
// rendered verbatim onto a PUSH notification (and into the in-app row) by
// `buildStandardTemplateRenderer`, which means a lock screen — the one surface
// where a home address is read by whoever is holding the phone. "Comes to you" is
// the fact the client needs to decide whether to open it; WHICH address is a
// question the offer card answers, behind the session.

import { ServiceLocationType } from '@prisma/client'

export type WaitlistOfferNotificationCopyInput = {
  /** Straight off the offer row — never a hand-written string union. */
  locationType: ServiceLocationType
  /** The pro's public display name, already resolved. */
  proName: string
  /** "Fri, Sep 4 at 10:00 AM", already formatted in the location's zone. */
  when: string
  serviceName: string
}

/**
 * The notification body for a pro-proposed waitlist time.
 *
 * SALON keeps its original §12 NC1 #25 wording — naming the pro, the concrete
 * slot, and the urgency — unchanged, because nothing about an in-salon offer
 * changed. MOBILE says who is coming to whom, first.
 */
export function buildWaitlistOfferNotificationBody(
  input: WaitlistOfferNotificationCopyInput,
): string {
  // Byte-identical to the original §12 NC1 #25 sentence, straight apostrophe and
  // all. The SALON notification is unchanged by this fix and its diff should
  // show that.
  const urgency = "Tap to confirm before it's gone."

  if (input.locationType === ServiceLocationType.MOBILE) {
    return `${input.proName} can come to you ${input.when} for your ${input.serviceName}. ${urgency}`
  }

  return `${input.proName} has ${input.when} open for your ${input.serviceName}. ${urgency}`
}
