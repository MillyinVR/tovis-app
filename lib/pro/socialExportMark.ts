// lib/pro/socialExportMark.ts
//
// Who gets an UNBRANDED social export — i.e. whose platform-ready renders carry
// only their own signature, with no small platform mark beside it.
//
// The render happens ON THE DEVICE (tovis-ios `SocialExportRenderer`), from bytes
// the server never sees, so the server cannot draw the mark. What it CAN own is the
// decision, and it does: `/api/v1/pro/membership/status` ships this as one resolved
// boolean, exactly like `canExportTaxDocs` on the finance payload. That keeps the
// tier rule in one place instead of re-deriving `entitlements.includes(...)` inside
// an app binary that ships on Apple's schedule rather than ours.
//
// 🔴 DECIDED 2026-08-20 (Tori): this gate reads the ENTITLEMENT ALONE and
// deliberately ignores ENABLE_MEMBERSHIP_ENFORCEMENT.
//
// It is the ONE paid gate in this repo that does not follow the master switch, so
// the exception is written down here rather than inferred. Every other gate — tax
// export, retention insights, the camera quota — resolves as GRANTED while the
// switch is off, because the switch exists so that turning enforcement on never
// takes away something pros already have. This one is different on purpose:
//
//   The platform mark is MARKETING, not a restriction. A free pro's marked export
//   is how the salon down the street first hears the name. Withholding it until
//   the master switch flips gives that reach away for nothing.
//
// ⚠️ Be honest about the cost, because it is real and it was weighed: the social
// export SHIPS. tovis-ios renders it (TovisKit SocialExport/) on
// ProSocialExportSheet, ProVideoExportSheet and ProMediaExport, all fed by this
// resolver's boolean as `ExportWatermark.showsPlatformMark`. So this change DOES
// take something away from free pros — their exports gain the mark. That cost was
// accepted at ~2 pros and 0 paying, and it only grows from here, which is exactly
// why it was settled now rather than bundled into the enforcement flip later.
//
// A paying pro is unaffected in every state: they had unbranded exports before and
// they have them now. Recorded in tovis-ios docs/design/camera-excellence-plan.md D1.

import type { Entitlement } from '@/lib/pro/entitlements'

export const SOCIAL_EXPORT_UNBRANDED: Entitlement = 'social_export_unbranded'

/**
 * Whether this pro's social exports drop the platform mark, given the entitlements
 * already resolved for them. Pure, and a pure function of the entitlements alone —
 * there is deliberately no flag parameter to pass, so no call site can reintroduce
 * the master-switch short-circuit by accident. See the header for why.
 */
export function exportsDropPlatformMark(
  entitlements: readonly Entitlement[],
): boolean {
  return entitlements.includes(SOCIAL_EXPORT_UNBRANDED)
}
