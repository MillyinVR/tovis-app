import { ViralServiceRequestStatus } from '@prisma/client'

export function getViralRequestStatusLabel(
  status: ViralServiceRequestStatus,
): string {
  switch (status) {
    case ViralServiceRequestStatus.APPROVED:
      return 'Approved'
    case ViralServiceRequestStatus.REJECTED:
      return 'Denied'
    case ViralServiceRequestStatus.IN_REVIEW:
      return 'In review'
    case ViralServiceRequestStatus.REQUESTED:
    default:
      return 'Requested'
  }
}

export function getViralRequestStatusTone(
  status: ViralServiceRequestStatus,
): string {
  switch (status) {
    case ViralServiceRequestStatus.APPROVED:
      return 'text-toneSuccess'
    case ViralServiceRequestStatus.REJECTED:
      return 'text-toneDanger'
    case ViralServiceRequestStatus.IN_REVIEW:
      return 'text-accentPrimary'
    case ViralServiceRequestStatus.REQUESTED:
    default:
      return 'text-toneWarn'
  }
}

export function canTransitionViralRequestStatus(
  from: ViralServiceRequestStatus,
  to: ViralServiceRequestStatus,
): boolean {
  if (from === to) return true

  switch (from) {
    case ViralServiceRequestStatus.REQUESTED:
      return (
        to === ViralServiceRequestStatus.IN_REVIEW ||
        to === ViralServiceRequestStatus.APPROVED ||
        to === ViralServiceRequestStatus.REJECTED
      )

    case ViralServiceRequestStatus.IN_REVIEW:
      return (
        to === ViralServiceRequestStatus.APPROVED ||
        to === ViralServiceRequestStatus.REJECTED
      )

    case ViralServiceRequestStatus.APPROVED:
    case ViralServiceRequestStatus.REJECTED:
      return false

    default:
      return false
  }
}