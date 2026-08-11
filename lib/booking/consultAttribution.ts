import { ConsultSessionStatus } from '@prisma/client'

export type FinalizeConsultAttributionCandidate = {
  clientId: string
  professionalId: string
  serviceCategoryId: string
  status: ConsultSessionStatus
}

/** No-leak ownership/scope predicate shared by the finalize boundary and tests. */
export function isFinalizeConsultAttributionOwned(args: {
  candidate: FinalizeConsultAttributionCandidate
  clientId: string
  professionalId: string
  serviceCategoryId: string | null
}): boolean {
  return (
    args.candidate.status === ConsultSessionStatus.COMPLETED &&
    args.candidate.clientId === args.clientId &&
    args.candidate.professionalId === args.professionalId &&
    args.serviceCategoryId !== null &&
    args.candidate.serviceCategoryId === args.serviceCategoryId
  )
}
