// lib/licensing/licenseExpiryNotifications.ts
//
// License-expiry lifecycle notifications (Tori approved 2026-08-06). The
// verified badge itself is fully derived (lib/licensing/currentlyLicensed.ts —
// no DB write flips it), so this sweep's only job is telling the pro:
//   1. WARN  at (expiry - warnDays): one heads-up, deduped per (pro, expiry).
//   2. EXPIRED at expiry: one "your badge is paused" notice, same dedupe shape.
// Renewal (admin approves a new licenseExpiry) changes the dedupe key, so a
// fresh cycle can fire for the new date — nothing to reset by hand. Repeated
// daily runs after expiry keep matching the same dedupeKey, which
// createProNotification treats as an idempotent refresh, NOT a re-send (see
// its contract) — so this is safe to run forever without re-notifying.
import 'server-only'

import { NotificationEventKey, VerificationStatus } from '@prisma/client'
import type { ProfessionType } from '@prisma/client'

import {
  relativeDayPhrase,
  wholeDaysUntil,
} from '@/lib/notifications/relativeWhen'
import { prisma } from '@/lib/prisma'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { requiresLicense } from '@/lib/licensing/licenseRequirement'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'

/** How many days before expiry the heads-up notification fires. */
export const LICENSE_EXPIRY_WARN_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type LicenseExpiryResult = {
  warned: number
  expired: number
}

type LicenseExpiryCandidate = {
  id: string
  professionType: ProfessionType | null
  licenseState: string | null
  licenseExpiry: Date | null
}

/**
 * Runs one warn+expired-notice pass. Idempotent per the module doc above.
 */
export async function runLicenseExpiryNotifications(
  now: Date = new Date(),
  opts: { warnDays?: number } = {},
): Promise<LicenseExpiryResult> {
  const warnDays = opts.warnDays ?? LICENSE_EXPIRY_WARN_DAYS
  const warnCutoff = new Date(now.getTime() + warnDays * MS_PER_DAY)

  const warned = await warnExpiringLicenses({ now, warnCutoff })
  const expired = await notifyExpiredLicenses({ now })

  return { warned, expired }
}

/** requiresLicense() is per (profession, state) — not expressible as a Prisma
 * where clause, so candidates are loaded broadly (approved + verified + an
 * expiry in range) and filtered in application code, same shape as
 * lib/handles/reservationExpiry.ts. */
function isLicenseGated(pro: LicenseExpiryCandidate): pro is LicenseExpiryCandidate & {
  professionType: ProfessionType
  licenseExpiry: Date
} {
  return (
    Boolean(pro.professionType) &&
    Boolean(pro.licenseExpiry) &&
    requiresLicense(pro.professionType as ProfessionType, pro.licenseState)
  )
}

/**
 * Notify pros whose license enters the warning window (expiry within
 * `warnDays` but not yet past). Dedup keyed on (pro, expiry instant) so a
 * given expiry date is warned about at most once.
 */
async function warnExpiringLicenses(args: {
  now: Date
  warnCutoff: Date
}): Promise<number> {
  const candidates = await prisma.professionalProfile.findMany({
    // Platform-maintenance sweep across all tenants — an intentional cross-tenant read.
    where: {
      ...platformCrossTenantProVisibilityFilter(),
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
      licenseExpiry: { gt: args.now, lte: args.warnCutoff },
    },
    select: { id: true, professionType: true, licenseState: true, licenseExpiry: true },
  })

  let warned = 0
  for (const pro of candidates) {
    if (!isLicenseGated(pro)) continue

    const whenPhrase = relativeDayPhrase(
      wholeDaysUntil(pro.licenseExpiry, args.now),
    )

    await createProNotification({
      professionalId: pro.id,
      eventKey: NotificationEventKey.PRO_LICENSE_EXPIRING_SOON,
      title: 'Your license is expiring soon',
      body: `Your professional license expires ${whenPhrase}. Renew and upload your updated license to keep your verified badge.`,
      href: '/pro/verification',
      // One warning per (pro, expiry instant) — a renewal changes licenseExpiry
      // and so the dedupe key, letting a fresh cycle fire for the new date.
      dedupeKey: `license-expiring:${pro.id}:${pro.licenseExpiry.getTime()}`,
    })
    warned += 1
  }

  return warned
}

/**
 * Notify pros whose license has actually passed its expiry — the derived
 * badge (currentlyLicensed.ts) is already showing paused for these by the
 * time this runs; this is purely the notice, not the revoke.
 */
async function notifyExpiredLicenses(args: { now: Date }): Promise<number> {
  const candidates = await prisma.professionalProfile.findMany({
    where: {
      ...platformCrossTenantProVisibilityFilter(),
      verificationStatus: VerificationStatus.APPROVED,
      licenseVerified: true,
      licenseExpiry: { lte: args.now },
    },
    select: { id: true, professionType: true, licenseState: true, licenseExpiry: true },
  })

  let notified = 0
  for (const pro of candidates) {
    if (!isLicenseGated(pro)) continue

    await createProNotification({
      professionalId: pro.id,
      eventKey: NotificationEventKey.PRO_LICENSE_EXPIRED,
      title: 'Your verified badge is paused',
      body:
        'Your professional license has expired, so your verified badge is paused. Upload your renewed license to restore it.',
      href: '/pro/verification',
      dedupeKey: `license-expired:${pro.id}:${pro.licenseExpiry.getTime()}`,
    })
    notified += 1
  }

  return notified
}
