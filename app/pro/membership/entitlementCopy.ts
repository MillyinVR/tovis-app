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
  // 🔴 `pro_discovery_fee_waiver` is deliberately UNLABELED (Tori, 2026-08-04).
  //
  // It now waives the right thing — the PRO's $5 cold-match fee, never the
  // client's convenience fee (the fee model shipped 2026-08-05, brief §11.5). It is
  // still not advertised, and that is the decision, not an oversight: the sequencing
  // Tori locked is fees live -> measure conversion -> ONLY THEN advertise the waiver
  // as a membership perk. It is also inert until ENABLE_PLATFORM_FEES is flipped, so
  // a label today would sell a discount on a fee nobody is charged.
  //
  // Do NOT add a label back until BOTH have happened.
}

/**
 * The fee pitch, exactly as Tori chose it on 2026-08-04 (option A, verbatim).
 * Extracted so it is one canonical string with a test, mirroring iOS's
 * `ProMembershipCopy.commissionPitchBody`.
 *
 * ✅ THE CODE NOW MATCHES THIS COPY (fee model shipped 2026-08-05, brief §11.5).
 * The pro pays a flat $5 once per cold-match client (lib/booking/discoveryFee.ts,
 * `PRO_DISCOVERY_FEE_CENTS`), never a percentage of the service, and
 * `pro_discovery_fee_waiver` waives exactly that. The mis-description this comment
 * used to carry — a $5 charged to the CLIENT and a waiver pointed at the wrong fee —
 * is gone.
 *
 * ⚠️ One gap remains, by design: both fees are inert until ENABLE_PLATFORM_FEES is
 * flipped on. Until then a pro reading this is told they pay something they are not
 * yet charged. Tori chose this wording knowingly and owns the flip; if the fee model
 * changes, this string changes with it.
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
