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
// 🔴 The STREET ADDRESS is deliberately not here, and must not be added. This
// body is rendered verbatim onto a PUSH notification (and into the in-app row) by
// `buildStandardTemplateRenderer`, which means a lock screen — read by whoever is
// holding the phone, not only its owner.
//
// The address LABEL is different, and is included: a client can have several
// saved addresses and the offer resolves to their DEFAULT, so "comes to you" on
// its own leaves them unable to tell Home from Office until after they confirm.
// The label is their own word for the place ("Home", "Mum's"), which answers
// exactly that question and discloses nothing about where it is. The street line
// stays on the offer card, behind the session.

import { ServiceLocationType } from '@prisma/client'

export type WaitlistOfferNotificationCopyInput = {
  /** Straight off the offer row — never a hand-written string union. */
  locationType: ServiceLocationType
  /** The pro's public display name, already resolved. */
  proName: string
  /** "Fri, Sep 4 at 10:00 AM", already formatted in the location's zone. */
  when: string
  serviceName: string
  /**
   * MOBILE only: the client's own label for the address being travelled to.
   * null when they never named it — the sentence then simply omits it rather
   * than guessing.
   */
  addressLabel?: string | null
}

/**
 * Longest label that still leaves a readable sentence. A label is free text with
 * no length limit in the schema, and a very long one would push the urgency
 * clause out of a push preview — so an oversized label is DROPPED rather than
 * truncated, which would render a half-word and look broken.
 */
const MAX_LABEL_LENGTH = 40

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
    const label = input.addressLabel?.trim() ?? ''
    const where =
      label.length > 0 && label.length <= MAX_LABEL_LENGTH
        ? ` at ${label}`
        : ''

    return `${input.proName} can come to you${where} on ${input.when} for your ${input.serviceName}. ${urgency}`
  }

  return `${input.proName} has ${input.when} open for your ${input.serviceName}. ${urgency}`
}
