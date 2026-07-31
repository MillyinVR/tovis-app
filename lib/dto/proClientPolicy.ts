// The per-client booking-requirements wire contract —
// GET/PUT/DELETE /api/v1/pro/clients/{id}/policy.
//
// K16 built the switches, the resolver and the write route, but gave them no
// READ path: the only thing that ever showed a pro their stored policy was the
// chart page's own Prisma query. So the state existed on web and could not exist
// on a device at all — the same drift K6 found between the chart page and the
// chart API, and K13-web found on the pro booking detail. This file is the
// contract half of closing it.
//
// 🔴 What travels is the STORED row, never the RESOLVED policy.
// `resolveProClientPolicy` applies the card-on-file rail gate, so a switch the
// pro turned on resolves to false while ENABLE_NO_SHOW_PROTECTION is off. That
// is correct at booking time and WRONG in the control: a pro would open the form
// they just set and find it blank. The rail flag therefore travels SEPARATELY,
// as a capability, so the client can disable that one row instead of lying about
// its value. Web's chart page carries exactly the same split and says so at its
// own query ([[existing-control-can-still-be-lying]]).

import type { OfferingPrepayScope } from '@prisma/client'

/**
 * The four switches, exactly as stored. `null` for the whole object means the
 * pro has set no policy for this client — which is a different fact from four
 * falses, and the write route preserves the difference by DELETING the row
 * rather than storing an all-false one.
 */
export type ProClientPolicyDTO = {
  /** Widen the pro's deposit scope to cover this client's bookings. */
  requireDeposit: boolean
  /** Per-client prepay requirement, unioned with the offering's (wider wins). */
  prepayScope: OfferingPrepayScope | null
  /** Client must have a saved card before a booking can be finalized. */
  requireCardOnFile: boolean
  /** Client may not create a NEW appointment themselves. */
  blockSelfServeBooking: boolean
}

export type ProClientPolicyResponseDTO = {
  /** The stored policy, or null when this pro has set nothing for this client. */
  policy: ProClientPolicyDTO | null
  /**
   * Whether the save-card rail is live (ENABLE_NO_SHOW_PROTECTION).
   *
   * A capability, not a policy value: while this is false the write route 409s a
   * card-on-file requirement, so a client that renders that switch as available
   * is offering something the server will refuse. The device must gate the
   * CONTROL on this, not just handle the error
   * ([[kill-switch-must-reach-the-control]]).
   */
  cardOnFileRailEnabled: boolean
}
