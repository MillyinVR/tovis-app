import 'server-only'

import { ConsultActorType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { pickProfessionalPublicDisplayName, professionalPublicDisplayNameSelect } from '@/lib/privacy/professionalDisplayName'
import type { ClientConsultSessionsDTO } from '@/lib/dto/consult'
import { resolveThreadBooking } from './bookingLink'
import { isAiConsultEnabledForPro } from './access'
import { purgeConsultSessionRawObjects } from './capturePurge'
import { ConsultWriteError } from './errors'
import { finishClientConsultDeletion, prepareClientConsultDeletion } from './writeBoundary'

export async function loadClientConsultSessions(clientId: string, cursor?: string): Promise<ClientConsultSessionsDTO> {
  const rows = await prisma.consultSession.findMany({
    where: { clientId, bookingId: null, anchorLookPostId: { not: null }, inspiredBookings: { none: {} },
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    orderBy: { id: 'desc' }, take: 21,
    select: { id: true, anchorLookPostId: true, professionalId: true, status: true, updatedAt: true, createdAt: true,
      professional: { select: professionalPublicDisplayNameSelect },
    },
  })
  const page = rows.slice(0, 20)
  const eligible = await Promise.all(page.map(async row => {
    const appointment = await resolveThreadBooking(prisma, { consultSessionId: row.id, clientId,
      professionalId: row.professionalId, anchorLookPostId: row.anchorLookPostId,
      consultCreatedAt: row.createdAt, includePastBookings: true })
    return appointment ? null : row
  }))
  return {
    consultations: eligible.flatMap(row => row && row.anchorLookPostId ? [{ id: row.id, lookPostId: row.anchorLookPostId,
      professionalId: row.professionalId, professionalName: pickProfessionalPublicDisplayName(row.professional),
      updatedAt: row.updatedAt.toISOString(),
      canResume: row.status !== 'CANCELLED' && isAiConsultEnabledForPro(row.professionalId),
    }] : []),
    nextCursor: rows.length > 20 ? page.at(-1)?.id ?? null : null,
  }
}

export async function deleteClientConsultSession(args: { consultSessionId: string; clientId: string; actorUserId: string }) {
  const scope = { ...args, actor: { type: ConsultActorType.CLIENT, id: args.actorUserId } }
  await prepareClientConsultDeletion(scope)
  const cleanup = await purgeConsultSessionRawObjects(args.consultSessionId)
  if (cleanup.failed) {
    // Keep the cancelled session and its storage pointers for a safe retry.
    throw new ConsultWriteError('CAPTURE_STORAGE_UNAVAILABLE', 'Photo cleanup is still pending. Please retry deletion.')
  }
  await finishClientConsultDeletion(scope)
}
