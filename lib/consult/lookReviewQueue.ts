import 'server-only'
import { prisma } from '@/lib/prisma'
import { isAiConsultC6ExposureEnabledForPro } from './access'
import { CONSULT_OPEN_WINDOW_SELECT, consultLinkedBooking } from './openWindow'
import { evaluateConsultAnchorScope } from './anchor'

export async function loadProLookReviewQueue(professionalId: string, cursor?: string) {
  if (!isAiConsultC6ExposureEnabledForPro(professionalId)) return { items: [], nextCursor: null }
  const sessions = await prisma.consultSession.findMany({
    where: { professionalId, lookBriefVersions: { some: {} }, status: 'COMPLETED' },
    select: { ...CONSULT_OPEN_WINDOW_SELECT, id: true, client: { select: { firstName: true } },
      lookBriefVersions: { orderBy: { version: 'desc' }, take: 1,
        select: { version: true, awaitingAnalysis: true, selectedPathIndex: true, clientAcknowledgedAt: true, professionalAcknowledgedAt: true, changeSummary: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  return { nextCursor: sessions.length > 50 ? sessions[49]?.id ?? null : null,
    items: sessions.slice(0, 50).filter(session => evaluateConsultAnchorScope(session).eligible).map(session => {
      const version = session.lookBriefVersions[0]
      const booking = consultLinkedBooking(session)
      const clientName = session.client.firstName || 'Client' // pii-plaintext-read-ok: assigned pro’s authorized private consultation queue, matching their appointment list.
      return { consultId: session.id, clientName, version: version?.version ?? 1,
        appointmentStatus: booking?.status ?? null,
        awaitingAnalysis: version?.awaitingAnalysis ?? true,
        clientConfirmed: version?.clientAcknowledgedAt !== null && version?.clientAcknowledgedAt !== undefined,
        professionalConfirmed: version?.professionalAcknowledgedAt !== null && version?.professionalAcknowledgedAt !== undefined,
        selected: version?.selectedPathIndex !== null && version?.selectedPathIndex !== undefined,
        scheduledFor: booking?.scheduledFor.toISOString() ?? null,
        bookingId: booking?.id ?? null,
        changes: Array.isArray(version?.changeSummary) ? version.changeSummary.filter((entry): entry is string => typeof entry === 'string') : [],
      }
    }),
  }
}
