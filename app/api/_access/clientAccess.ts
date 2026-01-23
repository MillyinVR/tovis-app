// app/api/_access/clientAccess.ts
import { prisma } from '@/lib/prisma'

export type ClientAccess = {
  canViewProfile: boolean
  canSeeContactInfo: boolean
  canCreateNotes: boolean
  canEditAlerts: boolean
  canAddAllergies: boolean
}

export async function clientAccess(professionalId: string, clientId: string): Promise<ClientAccess> {
  const hasRelationship = await prisma.booking.findFirst({
    where: { professionalId, clientId },
    select: { id: true },
  })

  const ok = Boolean(hasRelationship)

  return {
    canViewProfile: ok,
    canSeeContactInfo: ok,
    canCreateNotes: ok,
    canEditAlerts: ok,
    canAddAllergies: ok,
  }
}
