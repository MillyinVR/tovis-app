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
  discovery_fee_waiver: 'Your new clients book with no discovery fee',
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
