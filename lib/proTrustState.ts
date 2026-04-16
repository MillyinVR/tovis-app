// lib/proTrustState.ts
import { Role, VerificationStatus } from '@prisma/client'

export const PUBLICLY_APPROVED_PRO_STATUSES = [
  VerificationStatus.APPROVED,
] as const

export function isPubliclyApprovedProStatus(
  status: VerificationStatus | null | undefined,
): boolean {
  return status === VerificationStatus.APPROVED
}

export function canEditPublicPublishingFields(
  status: VerificationStatus | null | undefined,
): boolean {
  return isPubliclyApprovedProStatus(status)
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

  return isOwner || isPubliclyApprovedProStatus(args.verificationStatus)
}

export function getPostVerificationNextUrl(args: {
  role: Role
  professionalVerificationStatus?: VerificationStatus | null
}): string {
  if (args.role === Role.ADMIN) return '/admin'
  if (args.role === Role.CLIENT) return '/looks'

  return isPubliclyApprovedProStatus(args.professionalVerificationStatus)
    ? '/pro/calendar'
    : '/pro/profile/public-profile'
}