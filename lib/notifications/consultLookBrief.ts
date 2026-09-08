import 'server-only'
import { NotificationEventKey, type Prisma } from '@prisma/client'
import { createProNotification } from './proNotifications'
import { upsertClientNotification } from './clientNotifications'

/** Notifications are doorbells; photos, history and adjustment reasons stay in the authorized brief. */
export async function notifyConsultLookBriefVersion(tx: Prisma.TransactionClient, version: {
  id: string; consultSessionId: string; version: number; createdByActorType: string; createdByActorId: string | null
}) {
  const session = await tx.consultSession.findUniqueOrThrow({ where: { id: version.consultSessionId },
    select: { clientId: true, professionalId: true } })
  const common = { eventKey: NotificationEventKey.LOOK_BRIEF_REVIEW, title: 'Look plan ready for review',
    body: `Version ${version.version} is ready. Review what changed and confirm the current plan.`,
    data: { consultSessionId: version.consultSessionId, lookBriefVersionId: version.id, version: version.version },
    dedupeKey: `look-brief:${version.id}`, tx }
  if (version.createdByActorType === 'PROFESSIONAL') {
    await upsertClientNotification({ ...common, clientId: session.clientId,
      href: `/client/consult/${encodeURIComponent(version.consultSessionId)}` })
  } else {
    await createProNotification({ ...common, professionalId: session.professionalId, actorUserId: version.createdByActorId,
      href: `/pro/consults/${encodeURIComponent(version.consultSessionId)}` })
  }
}
