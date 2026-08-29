// lib/proTrustState.ts
//
// Who may take part in the marketplace, and what the licence actually means.
//
// ## The rule (Tori, 2026-08-25)
// A verified licence is a BADGE, not a gate. It is not a hard block, and the
// only thing that bars a pro from the marketplace is an admin's active refusal
// — `REJECTED`, or `NEEDS_INFO` meaning "we asked you for something and you
// have not sent it". An unreviewed pro is not a refused pro: `PENDING` and
// `PENDING_MANUAL_REVIEW` are the ordinary state of somebody who signed up
// this morning, and the queue that clears them is ours, not theirs.
//
// So a pro who has not been reviewed gets a public profile, appears in search
// and discovery, and is bookable. What they do NOT get is the "✓ License
// verified" chip (see ProfileIdentityRail) — that is what `APPROVED` buys, and
// it is what a client reads to tell the two apart. They are still asked to
// verify: ProComplianceBanner nudges on a missing document, a pending review
// and an approaching expiry, and it is driven by the DOCUMENTS, not by this
// file, so it keeps nudging after the gate is gone.
//
// ⚠️ v2 will gate selling products and taking classes on a verified licence.
// That is what `hasVerifiedLicenceBadge` is for. Do NOT reach for
// `canListProPublicly` to build it — the two answer different questions, and
// collapsing them is how the hard block grows back.
//
// An EXPIRED licence is a different matter and is still a hard block on
// booking; it lives in lib/pro/readiness/proReadiness.ts, because it is about
// a credential that lapsed rather than one never reviewed.

import { MediaVisibility, Role, VerificationStatus } from '@/lib/prismaEnums'

/**
 * Whether each verification status bars a pro from the marketplace.
 *
 * `satisfies Record<VerificationStatus, boolean>` is the load-bearing part:
 * adding a status to the Prisma enum fails this file to compile rather than
 * silently defaulting somebody into — or out of — public listing.
 */
const STATUS_BARS_FROM_MARKETPLACE = {
  // Not reviewed yet. Ours to clear, so it costs them nothing.
  PENDING: false,
  PENDING_MANUAL_REVIEW: false,
  // Reviewed and cleared. Earns the badge; see hasVerifiedLicenceBadge.
  APPROVED: false,
  // An admin actively said no.
  REJECTED: true,
  // An admin asked for something and is still waiting for it.
  NEEDS_INFO: true,
} satisfies Record<VerificationStatus, boolean>

/** Statuses a pro may be publicly listed under — for Prisma `in:` filters. */
export const PUBLICLY_LISTABLE_PRO_STATUSES = (
  Object.keys(STATUS_BARS_FROM_MARKETPLACE) as VerificationStatus[]
).filter((status) => !STATUS_BARS_FROM_MARKETPLACE[status])

/**
 * An admin has actively refused this pro, or is waiting on them.
 *
 * A missing status is NOT a refusal — the absence of a review is the ordinary
 * state of a new pro — so null/undefined is `false` here. Callers that need
 * "may be listed" want `canListProPublicly`, which treats a missing status as
 * "no profile to list".
 */
export function isBarredProStatus(
  status: VerificationStatus | null | undefined,
): boolean {
  if (!status) return false

  return STATUS_BARS_FROM_MARKETPLACE[status]
}

/**
 * May this pro appear publicly — profile page, search, discovery, the feed?
 *
 * Replaced the old `isPubliclyApproved…` predicate, which demanded APPROVED.
 * The rename is deliberate: a function whose name says "approved" but which
 * returns true for PENDING is the kind of lie the next person builds a real
 * gate on top of.
 */
export function canListProPublicly(
  status: VerificationStatus | null | undefined,
): boolean {
  if (!status) return false

  return !isBarredProStatus(status)
}

/**
 * Has this pro's licence actually been checked? This is the BADGE — the one
 * thing APPROVED still buys, and the hook v2's products/classes should gate on.
 */
export function hasVerifiedLicenceBadge(
  status: VerificationStatus | null | undefined,
): boolean {
  return status === VerificationStatus.APPROVED
}

export function canEditPublicPublishingFields(
  status: VerificationStatus | null | undefined,
): boolean {
  return canListProPublicly(status)
}

export function canViewerSeeProPublicSurface(args: {
  viewerRole?: Role | null
  viewerProfessionalId?: string | null
  professionalId: string
  verificationStatus: VerificationStatus | null | undefined
}): boolean {
  const isOwner =
    args.viewerRole === Role.PRO &&
    !!args.viewerProfessionalId &&
    args.viewerProfessionalId === args.professionalId

  return isOwner || canListProPublicly(args.verificationStatus)
}

export function canViewerSeePublicMediaSurface(args: {
  viewerRole?: Role | null
  viewerProfessionalId?: string | null
  professionalId: string
  verificationStatus: VerificationStatus | null | undefined
  visibility: MediaVisibility
}): boolean {
  if (args.visibility !== MediaVisibility.PUBLIC) return false

  return canViewerSeeProPublicSurface({
    viewerRole: args.viewerRole,
    viewerProfessionalId: args.viewerProfessionalId,
    professionalId: args.professionalId,
    verificationStatus: args.verificationStatus,
  })
}

/**
 * Where a pro lands after finishing phone/email verification.
 *
 * Still keyed on the BADGE rather than on listing: a pro who has been through
 * review has a finished profile and wants their calendar, while everybody else
 * is most likely mid-setup and wants the profile page. That is a "what were
 * you probably doing" guess, not a permission — an unreviewed pro reaching
 * /pro/calendar directly is fine and always was.
 */
export function getPostVerificationNextUrl(args: {
  role: Role
  professionalVerificationStatus?: VerificationStatus | null
}): string {
  if (args.role === Role.ADMIN) return '/admin'
  if (args.role === Role.CLIENT) return '/looks'

  return hasVerifiedLicenceBadge(args.professionalVerificationStatus)
    ? '/pro/calendar'
    : '/pro/profile/public-profile'
}
