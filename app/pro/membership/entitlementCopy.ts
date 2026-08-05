// app/pro/membership/entitlementCopy.ts
//
// Customer-facing copy for the entitlements listed on /pro/membership.
//
// 🔴 This map is PARTIAL on purpose. An entitlement with no entry here is still
// granted — it simply is never named in a list a paying pro reads. That is the
// mechanism keeping `white_label` (comp-only, no implementation call site) off the
// membership page while it stays in the entitlement matrix for a comped salon
// partner. Adding a label here is therefore a PROMISE to the buyer: only add one
// once the entitlement has a real implementation call site.
//
// Context: docs/design/membership-value-brief.md §1.2 / §5.1.F — `advanced_analytics`
// shipped in the PRO array with zero call sites, so the page rendered
// "✓ Advanced analytics & retention insights" to anyone who paid. It is back below
// only because it now HAS one (lib/analytics/proRetentionInsights.ts → the gated
// retention section on /pro/dashboard), and the wording was narrowed to describe
// exactly what that section shows.

import type { Entitlement } from '@/lib/pro/entitlements'

const ENTITLEMENT_LABELS: Partial<Record<Entitlement, string>> = {
  custom_handle: 'Custom .tovis handle',
  tax_export: 'Tax exports (CSV + Schedule C) + transaction ledger',
  advanced_analytics:
    'Retention insights — rebooking rate over time + who’s due back',
  priority_discovery: 'Priority placement in Discovery',
  // 🔴 `discovery_fee_waiver` is deliberately UNLABELED (Tori, 2026-08-04).
  //
  // As coded it zeroes the fee the CLIENT pays, which is not the intended perk.
  // The intended model is two fees on a cold match — a client convenience fee and
  // a pro-side fee — with membership waiving the PRO's fee only, never the
  // client's. That model is not built (see membership-value-brief.md §8.5), so
  // there is nothing honest to advertise here yet.
  //
  // The mechanics stay in code, flag-gated and inert. Do NOT add a label back
  // until the pro-side fee ships AND its conversion impact has been measured —
  // that sequencing is part of the decision, not an accident.
}

/**
 * The fee pitch, exactly as Tori chose it on 2026-08-04 (option A, verbatim).
 * Extracted so it is one canonical string with a test, mirroring iOS's
 * `ProMembershipCopy.commissionPitchBody`.
 *
 * 🔴 THIS COPY DESCRIBES THE PLANNED FEE MODEL, NOT TODAY'S CODE. Under the model
 * (brief §11.5) the pro pays a flat $5 once per cold-match client and membership
 * waives it — which is what this says, and it stays true when that ships.
 *
 * Today, however, there is NO pro-side fee: the $5 is charged to the CLIENT, and
 * `discovery_fee_waiver` is flag-gated off. So a pro reading this today is told
 * they pay something they do not, and that membership waives something it does
 * not yet waive. Tori chose this wording knowingly; the safe sequencing is to
 * deploy it WITH the fee-model card, not before it. If the fee model changes,
 * this string changes with it.
 *
 * The brand name is interpolated rather than literal: the white-label guard forbids
 * a hardcoded brand string, so each tenant renders its own `displayName`. Note the
 * casing therefore follows that field, which is upper-case for the default brand.
 */
export function feePitchBody(brandName: string): string {
  return (
    'We never take a percentage of your work. Ever. ' +
    `One flat $5 when ${brandName} brings you a brand-new client ` +
    '— and members don’t even pay that.'
  )
}

export type AdvertisedEntitlement = { key: Entitlement; label: string }

/**
 * The subset of a plan's entitlements that carries customer-facing copy, in the
 * matrix's own order. Anything unlabeled is dropped rather than rendered with a
 * blank or auto-titled name.
 */
export function advertisedEntitlements(
  entitlements: readonly Entitlement[],
): AdvertisedEntitlement[] {
  return entitlements.flatMap((key) => {
    const label = ENTITLEMENT_LABELS[key]
    return label ? [{ key, label }] : []
  })
}
