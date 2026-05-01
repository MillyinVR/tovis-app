// lib/aftercare/aftercareSummary.ts

import { prisma } from '@/lib/prisma'

/** Fetch an existing AftercareSummary for a booking, or null. */
export async function getAftercareSummary(bookingId: string) {
  return prisma.aftercareSummary.findUnique({
    where: { bookingId },
  })
}

/**
 * Enqueue the aftercare summary for delivery to the client.
 * Creates a NotificationDispatch (idempotent via sourceKey uniqueness).
 * Sets sentToClientAt on the AftercareSummary atomically.
 * Does NOT mutate booking status — caller handles that.
 */
export async function enqueueAftercareSend(args: {
  aftercareSummaryId: string
  bookingId: string
  clientId: string
  professionalId: string
}): Promise<void> {
  // Mark sentToClientAt on the summary if not already set
  await prisma.aftercareSummary.updateMany({
    where: { id: args.aftercareSummaryId, sentToClientAt: null },
    data: { sentToClientAt: new Date() },
  })

  // Create a NotificationDispatch for client delivery
  // The notification processor cron picks this up and delivers via SMS/email
  const sourceKey = `aftercare-send:${args.aftercareSummaryId}`

  const existing = await prisma.notificationDispatch.findUnique({
    where: { sourceKey },
    select: { id: true },
  })
  if (existing) return // already enqueued — idempotent

  const client = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: { email: true, phone: true, userId: true },
  })

  if (!client) {
    throw new Error('Client profile not found for the provided clientId.')
  }

  await prisma.notificationDispatch.create({
    data: {
      sourceKey,
      eventKey: 'AFTERCARE_READY',
      recipientKind: 'CLIENT',
      priority: 'NORMAL',
      clientId: args.clientId,
      professionalId: args.professionalId,
      recipientEmail: client.email ?? null,
      recipientPhone: client.phone ?? null,
      title: 'Your aftercare summary is ready',
      body: 'Your service is complete. View your aftercare instructions.',
      href: `/t/${args.bookingId}/aftercare`,
      scheduledFor: new Date(),
    },
  })
}
