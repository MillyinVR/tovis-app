// lib/looks/guards.ts
import { MediaVisibility, Role, VerificationStatus } from '@prisma/client'
import { isPubliclyApprovedProStatus } from '@/lib/proTrustState'

export type LookViewPolicyInput = {
  isOwner: boolean
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  proVerificationStatus: VerificationStatus | null | undefined
}

export type LookEditPolicyInput = {
  isOwner: boolean
}

export type LookModerationPolicyInput = {
  viewerRole: Role | null | undefined
}

export function isPublicLooksEligibleMedia(args: {
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
}): boolean {
  if (args.visibility !== MediaVisibility.PUBLIC) return false

  return Boolean(args.isEligibleForLooks || args.isFeaturedInPortfolio)
}

export function canViewLookPost(args: LookViewPolicyInput): boolean {
  if (args.isOwner) return true

  const isPublicEligible = isPublicLooksEligibleMedia({
    visibility: args.visibility,
    isEligibleForLooks: args.isEligibleForLooks,
    isFeaturedInPortfolio: args.isFeaturedInPortfolio,
  })

  if (!isPublicEligible) return false

  return isPubliclyApprovedProStatus(args.proVerificationStatus ?? null)
}

export function canEditLookPost(args: LookEditPolicyInput): boolean {
  return args.isOwner
}

export function canCommentOnLookPost(args: LookViewPolicyInput): boolean {
  return canViewLookPost(args)
}

export function canSaveLookPost(args: LookViewPolicyInput): boolean {
  return canViewLookPost(args)
}

export function canModerateLookPost(
  args: LookModerationPolicyInput,
): boolean {
  return args.viewerRole === Role.ADMIN
}