// lib/licensing/currentlyLicensed.ts
//
// Single source of truth for "is this pro currently licensed" — derived, not
// stored. Nothing flips a boolean when a license expires; every reader
// (today: only the verified-badge mapper) asks this function fresh, so the
// badge auto-revokes the instant `licenseExpiry` passes with zero extra
// state and zero renewal-reset bookkeeping. Renewal is just: admin approves a
// new expiry date, and the very next read reflects it.
//
// Do NOT re-derive this elsewhere (e.g. `verificationStatus === APPROVED &&
// licenseVerified` inline) — a second copy is exactly the kind of drift this
// file exists to prevent. Import `isProCurrentlyLicensed` /
// `getProLicenseStatus` instead.
import type { ProfessionType, VerificationStatus as VerificationStatusType } from '@prisma/client'
import { VerificationStatus } from '@prisma/client'

import { requiresLicense } from '@/lib/licensing/licenseRequirement'

export type LicenseStatus =
  /** Approved, verified, and (if it has a known expiry) not past it. */
  | 'CURRENT'
  /** Was approved + verified, but `licenseExpiry` has passed. */
  | 'EXPIRED'
  /** Not approved, not marked licenseVerified, or no license on file. */
  | 'UNVERIFIED'
  /** This profession/state combination doesn't require a license at all. */
  | 'NOT_REQUIRED'

export type LicenseStatusInput = {
  professionType: ProfessionType | null
  licenseState: string | null
  verificationStatus: VerificationStatusType
  licenseVerified: boolean
  licenseExpiry: Date | null
}

/**
 * Classifies a pro's license status as of `now`.
 *
 * A null `licenseExpiry` on an otherwise-approved, verified pro is treated as
 * CURRENT rather than EXPIRED — legacy rows approved before expiry capture
 * existed have no expiry on file, and this feature must not silently revoke
 * badges for data it never collected. Only a licenseExpiry that is actually
 * set AND in the past counts as EXPIRED.
 */
export function getProLicenseStatus(
  pro: LicenseStatusInput,
  now: Date = new Date(),
): LicenseStatus {
  if (!pro.professionType || !requiresLicense(pro.professionType, pro.licenseState)) {
    return 'NOT_REQUIRED'
  }

  if (pro.verificationStatus !== VerificationStatus.APPROVED || !pro.licenseVerified) {
    return 'UNVERIFIED'
  }

  if (pro.licenseExpiry && pro.licenseExpiry.getTime() <= now.getTime()) {
    return 'EXPIRED'
  }

  return 'CURRENT'
}

/** The one place gated features should ask "can this pro rely on being licensed right now?" */
export function isProCurrentlyLicensed(
  pro: LicenseStatusInput,
  now: Date = new Date(),
): boolean {
  return getProLicenseStatus(pro, now) === 'CURRENT'
}
