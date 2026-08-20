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
// 🔴 The enforcement-flag convention, and the decision hiding inside it.
//
// While ENABLE_MEMBERSHIP_ENFORCEMENT is off, every other paid gate in this repo
// resolves as GRANTED — the tax-export gate, the retention-insights gate, the
// camera quota. This follows them, because inventing a third rule for one feature
// is how gates drift. The consequence is worth saying out loud rather than burying:
//
//   TODAY, WITH THE FLAG OFF, A FREE PRO AND A PAYING PRO EXPORT THE SAME
//   UNBRANDED IMAGE. The perk is real in code and invisible in production until
//   Tori flips the flag.
//
// There is a legitimate argument for gating this one on the entitlement ALONE,
// ignoring the flag: the platform mark is marketing rather than a restriction — a
// free pro's export is how a salon down the street first hears the name. Flipping
// to that behaviour is a one-line change here (drop the `enforcementEnabled`
// short-circuit) plus its test. Tori's call, recorded in tovis-ios
// docs/design/camera-excellence-plan.md D1.
//
// 🔴 The OTHER half of that argument has expired — do not repeat it. This comment
// used to add "and social export does not exist yet, so there is nothing to take
// away". It exists now: tovis-ios renders it (TovisKit SocialExport/) and ships it
// on real surfaces — ProSocialExportSheet, ProVideoExportSheet, ProMediaExport —
// which draw the mark straight from this resolver's boolean as
// `ExportWatermark.showsPlatformMark`. So flipping ENABLE_MEMBERSHIP_ENFORCEMENT
// DOES take something away: every free pro's exports start carrying the mark the
// day it flips. That is an argument for deciding this deliberately, not for
// assuming it is free.

import { membershipEnforcementEnabled } from '@/lib/membership/enforcement'
import type { Entitlement } from '@/lib/pro/entitlements'

export const SOCIAL_EXPORT_UNBRANDED: Entitlement = 'social_export_unbranded'

/**
 * Whether this pro's social exports drop the platform mark, given the entitlements
 * already resolved for them. Pure — the caller supplies the entitlement list and
 * (in tests) the flag state.
 */
export function exportsDropPlatformMark(
  entitlements: readonly Entitlement[],
  enforcementEnabled: boolean = membershipEnforcementEnabled(),
): boolean {
  if (!enforcementEnabled) return true
  return entitlements.includes(SOCIAL_EXPORT_UNBRANDED)
}
