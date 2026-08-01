// lib/proClientPolicy/summary.ts
//
// K16-B — one description of "what did this pro require of this client", shared
// by every surface that shows it.
//
// K16 shipped the switches with exactly one place to see them: the chart page's
// own control, one client at a time. A pro with fifty clients had no way to ask
// "who have I put requirements on?" without opening fifty charts. This turns a
// stored row into the labels a list can render, so the badge on the roster and
// the form on the chart can never drift into describing the same switch two
// different ways.
//
// 🔴 Takes the STORED row, never the RESOLVED policy. `resolveProClientPolicy`
// applies the card-on-file rail gate, so a switch the pro turned on resolves to
// false while ENABLE_NO_SHOW_PROTECTION is off. A roster built on the resolved
// value would show "no requirements" for a client the pro had explicitly
// restricted. The rail flag arrives separately and marks that one requirement
// INACTIVE instead of hiding it — the pro set it, and it is not being enforced,
// and both halves of that are true at once
// ([[existing-control-can-still-be-lying]]).

import type { OfferingPrepayScope } from '@prisma/client'

/** The four switches exactly as stored. Mirrors `PRO_CLIENT_POLICY_SELECT`. */
export type StoredProClientPolicy = {
  requireDeposit: boolean
  prepayScope: OfferingPrepayScope | null
  requireCardOnFile: boolean
  blockSelfServeBooking: boolean
}

export type ProClientRequirementKey =
  | 'deposit'
  | 'prepay'
  | 'cardOnFile'
  | 'noOnlineBooking'

export type ProClientRequirement = {
  key: ProClientRequirementKey
  /** Short label for a chip. Pro-facing; the client never sees these. */
  label: string
  /**
   * True when the pro SET this requirement but the server will not act on it.
   * Today only card-on-file can land here, when the save-card rail is dark.
   */
  inactive: boolean
}

/**
 * The requirements a pro has set for one client, in a stable display order.
 *
 * Returns `[]` for a null policy (no row) AND for a row whose switches are all
 * off — both mean "nothing required". The write route deletes rather than
 * storing an all-false row, so the second case should not occur, but a summary
 * that reported "requirements set" for four falses would put a client on the
 * roster with no requirement to show.
 */
export function summarizeProClientPolicy(args: {
  policy: StoredProClientPolicy | null
  cardOnFileRailEnabled: boolean
}): ProClientRequirement[] {
  const { policy, cardOnFileRailEnabled } = args

  if (!policy) return []

  const requirements: ProClientRequirement[] = []

  if (policy.requireDeposit) {
    requirements.push({ key: 'deposit', label: 'Deposit', inactive: false })
  }

  if (policy.prepayScope != null) {
    requirements.push({
      key: 'prepay',
      label:
        policy.prepayScope === 'SERVICE_ONLY'
          ? 'Prepay (service)'
          : 'Prepay (whole booking)',
      inactive: false,
    })
  }

  if (policy.requireCardOnFile) {
    requirements.push({
      key: 'cardOnFile',
      label: 'Card on file',
      inactive: !cardOnFileRailEnabled,
    })
  }

  if (policy.blockSelfServeBooking) {
    requirements.push({
      key: 'noOnlineBooking',
      label: 'No online booking',
      inactive: false,
    })
  }

  return requirements
}
