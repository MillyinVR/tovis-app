// lib/looks/guards.ts
import {
  LookPostStatus,
  LookPostVisibility,
  MediaVisibility,
  ModerationStatus,
  Role,
  VerificationStatus,
} from '@prisma/client'
import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'

export type LookViewPolicyInput = {
  isOwner: boolean
  viewerRole?: Role | null
  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus
  proVerificationStatus: VerificationStatus | null | undefined
  viewerFollowsProfessional?: boolean | null
}

export type LookEditPolicyInput = {
  isOwner: boolean
  viewerRole?: Role | null
}

export type LookModerationPolicyInput = {
  viewerRole: Role | null | undefined
}

/**
 * Legacy compatibility helper for old MediaAsset-based call sites.
 * Keep this only until those routes are migrated to LookPost-based guards.
 */
export function isPublicLooksEligibleMedia(args: {
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
}): boolean {
  if (args.visibility !== MediaVisibility.PUBLIC) return false

  return Boolean(args.isEligibleForLooks || args.isFeaturedInPortfolio)
}

function isPubliclyViewablePublishedLook(args: {
  status: LookPostStatus
  visibility: LookPostVisibility
  moderationStatus: ModerationStatus
  proVerificationStatus: VerificationStatus | null | undefined
  viewerFollowsProfessional?: boolean | null
}): boolean {
  if (args.status !== LookPostStatus.PUBLISHED) return false
  if (args.moderationStatus !== ModerationStatus.APPROVED) return false
  if (!isPubliclyApprovedProStatus(args.proVerificationStatus ?? null)) {
    return false
  }

  switch (args.visibility) {
    case LookPostVisibility.PUBLIC:
      return true
    case LookPostVisibility.FOLLOWERS_ONLY:
      return Boolean(args.viewerFollowsProfessional)
    case LookPostVisibility.UNLISTED:
      return true
    default:
      return false
  }
}

export function canViewLookPost(args: LookViewPolicyInput): boolean {
  if (args.isOwner) return true
  if (args.viewerRole === Role.ADMIN) return true

  return isPubliclyViewablePublishedLook({
    status: args.status,
    visibility: args.visibility,
    moderationStatus: args.moderationStatus,
    proVerificationStatus: args.proVerificationStatus,
    viewerFollowsProfessional: args.viewerFollowsProfessional,
  })
}

export function canEditLookPost(args: LookEditPolicyInput): boolean {
  return args.isOwner
}

export function canCommentOnLookPost(args: LookViewPolicyInput): boolean {
  if (!canViewLookPost(args)) return false
  if (args.viewerRole === Role.ADMIN) return false

  return (
    args.status === LookPostStatus.PUBLISHED &&
    args.moderationStatus === ModerationStatus.APPROVED
  )
}

export function canSaveLookPost(args: LookViewPolicyInput): boolean {
  if (!canViewLookPost(args)) return false
  if (args.viewerRole === Role.ADMIN) return false

  return (
    args.status === LookPostStatus.PUBLISHED &&
    args.moderationStatus === ModerationStatus.APPROVED
  )
}

export function canModerateLookPost(
  args: LookModerationPolicyInput,
): boolean {
  return args.viewerRole === Role.ADMIN
}