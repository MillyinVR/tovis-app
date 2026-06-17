import {
  BookingStatus,
  LastMinuteRecipientStatus,
  LastMinuteTier,
  NotificationEventKey,
  OpeningStatus,
  WaitlistPreferenceType,
  WaitlistStatus,
} from '@prisma/client'

import { isNonEmptyString } from '@/lib/guards'
import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'
import { isValidIanaTimeZone, getZonedParts } from '@/lib/timeZone'

const DEFAULT_PRIORITY_MINUTES = 30

export async function hasActivePriorityOffer(openingId: string): Promise<boolean> {
  const active = await prisma.lastMinuteRecipient.findFirst({
    where: {
      openingId,
      status: LastMinuteRecipientStatus.PRIORITY_OFFERED,
    },
    select: { id: true },
  })
  return !!active
}

export async function expireOverduePriorityOffers(openingId: string): Promise<number> {
  const now = new Date()

  const result = await prisma.lastMinuteRecipient.updateMany({
    where: {
      openingId,
      status: LastMinuteRecipientStatus.PRIORITY_OFFERED,
      priorityExpiresAt: { lte: now },
    },
    data: {
      status: LastMinuteRecipientStatus.PRIORITY_EXPIRED,
    },
  })

  return result.count
}

export type OfferNextResult =
  | { offered: true; recipientId: string; clientId: string }
  | { offered: false; reason: 'no_candidates' | 'opening_inactive' | 'active_offer_exists' }

export async function offerNextPriorityClient(args: {
  openingId: string
  professionalId: string
  priorityMinutes?: number
  notificationContent: {
    title: string
    body: string
    href: string
    data: Record<string, unknown>
  }
}): Promise<OfferNextResult> {
  const now = new Date()

  const opening = await prisma.lastMinuteOpening.findUnique({
    where: { id: args.openingId },
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      timeZone: true,
      services: { select: { serviceId: true } },
    },
  })

  if (!opening || opening.status !== OpeningStatus.ACTIVE) {
    return { offered: false, reason: 'opening_inactive' }
  }

  const activeOffer = await prisma.lastMinuteRecipient.findFirst({
    where: {
      openingId: args.openingId,
      status: LastMinuteRecipientStatus.PRIORITY_OFFERED,
      priorityExpiresAt: { gt: now },
    },
    select: { id: true },
  })

  if (activeOffer) {
    return { offered: false, reason: 'active_offer_exists' }
  }

  const alreadyOfferedClientIds = await getAlreadyOfferedClientIds(args.openingId)
  const conflictClientIds = await getTimeOverlapClientIds({
    professionalId: args.professionalId,
    startAt: opening.startAt,
    endAt: opening.endAt,
    now,
  })

  const serviceIds = opening.services
    .map((s) => s.serviceId)
    .filter(isNonEmptyString)

  if (serviceIds.length === 0) {
    return { offered: false, reason: 'no_candidates' }
  }

  const waitlistEntries = await prisma.waitlistEntry.findMany({
    where: {
      professionalId: args.professionalId,
      status: WaitlistStatus.ACTIVE,
      serviceId: { in: serviceIds },
      clientId: {
        notIn: [...alreadyOfferedClientIds, ...conflictClientIds],
      },
    },
    select: {
      clientId: true,
      createdAt: true,
      preferenceType: true,
      specificDate: true,
      timeOfDay: true,
      windowStartMin: true,
      windowEndMin: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  const matched = waitlistEntries.filter((entry) =>
    entryMatchesOpening(entry, opening.startAt, opening.timeZone),
  )

  const seen = new Set<string>()
  const fifoClients: string[] = []
  for (const entry of matched) {
    if (!seen.has(entry.clientId)) {
      seen.add(entry.clientId)
      fifoClients.push(entry.clientId)
    }
  }

  if (fifoClients.length === 0) {
    return { offered: false, reason: 'no_candidates' }
  }

  const nextClientId = fifoClients[0]!
  const minutes = args.priorityMinutes ?? DEFAULT_PRIORITY_MINUTES
  const expiresAt = new Date(now.getTime() + minutes * 60 * 1000)

  const maxOrder = await prisma.lastMinuteRecipient.aggregate({
    where: { openingId: args.openingId },
    _max: { priorityOrder: true },
  })
  const nextOrder = (maxOrder._max.priorityOrder ?? 0) + 1

  const recipient = await prisma.lastMinuteRecipient.upsert({
    where: {
      openingId_clientId: {
        openingId: args.openingId,
        clientId: nextClientId,
      },
    },
    update: {
      status: LastMinuteRecipientStatus.PRIORITY_OFFERED,
      notifiedAt: now,
      priorityExpiresAt: expiresAt,
      priorityOrder: nextOrder,
      firstMatchedTier: LastMinuteTier.WAITLIST,
      notifiedTier: LastMinuteTier.WAITLIST,
      matchedContext: {
        tier: 'WAITLIST',
        source: 'priority-offer',
        priorityMinutes: minutes,
      },
    },
    create: {
      openingId: args.openingId,
      clientId: nextClientId,
      firstMatchedTier: LastMinuteTier.WAITLIST,
      notifiedTier: LastMinuteTier.WAITLIST,
      status: LastMinuteRecipientStatus.PRIORITY_OFFERED,
      notifiedAt: now,
      priorityExpiresAt: expiresAt,
      priorityOrder: nextOrder,
      matchedContext: {
        tier: 'WAITLIST',
        source: 'priority-offer',
        priorityMinutes: minutes,
      },
    },
    select: { id: true },
  })

  const notification = await upsertClientNotification({
    clientId: nextClientId,
    eventKey: NotificationEventKey.LAST_MINUTE_OPENING_AVAILABLE,
    title: args.notificationContent.title,
    body: args.notificationContent.body,
    // Deep-link to the priority-offer page (countdown + claim/pass), not the
    // generic claim page — this client has an exclusive window, not a free-for-all.
    href: `/client/offers?accept=${recipient.id}`,
    dedupeKey: `priority-offer:${args.openingId}:${nextClientId}`,
    data: {
      ...args.notificationContent.data,
      recipientId: recipient.id,
      priorityOffer: true,
      expiresAt: expiresAt.toISOString(),
    },
  })

  await prisma.lastMinuteRecipient.update({
    where: { id: recipient.id },
    data: {
      sourceDispatchKey: `client-notification:${notification.id}`,
    },
  })

  return { offered: true, recipientId: recipient.id, clientId: nextClientId }
}

export async function acceptPriorityOffer(recipientId: string): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_priority' | 'expired' | 'opening_inactive' }
> {
  const recipient = await prisma.lastMinuteRecipient.findUnique({
    where: { id: recipientId },
    select: {
      id: true,
      status: true,
      priorityExpiresAt: true,
      openingId: true,
      opening: { select: { status: true } },
    },
  })

  if (!recipient) return { ok: false, reason: 'not_found' }
  if (recipient.status !== LastMinuteRecipientStatus.PRIORITY_OFFERED) {
    return { ok: false, reason: 'not_priority' }
  }
  if (recipient.opening.status !== OpeningStatus.ACTIVE) {
    return { ok: false, reason: 'opening_inactive' }
  }
  if (recipient.priorityExpiresAt && recipient.priorityExpiresAt <= new Date()) {
    await prisma.lastMinuteRecipient.update({
      where: { id: recipientId },
      data: { status: LastMinuteRecipientStatus.PRIORITY_EXPIRED },
    })
    return { ok: false, reason: 'expired' }
  }

  await prisma.lastMinuteRecipient.update({
    where: { id: recipientId },
    data: {
      status: LastMinuteRecipientStatus.CLICKED,
      clickedAt: new Date(),
    },
  })

  return { ok: true }
}

export async function declinePriorityOffer(recipientId: string): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_priority' }
> {
  const recipient = await prisma.lastMinuteRecipient.findUnique({
    where: { id: recipientId },
    select: { id: true, status: true },
  })

  if (!recipient) return { ok: false, reason: 'not_found' }
  if (recipient.status !== LastMinuteRecipientStatus.PRIORITY_OFFERED) {
    return { ok: false, reason: 'not_priority' }
  }

  await prisma.lastMinuteRecipient.update({
    where: { id: recipientId },
    data: { status: LastMinuteRecipientStatus.PRIORITY_DECLINED },
  })

  return { ok: true }
}

async function getAlreadyOfferedClientIds(openingId: string): Promise<string[]> {
  const rows = await prisma.lastMinuteRecipient.findMany({
    where: { openingId },
    select: { clientId: true },
    take: 5000,
  })
  return rows.map((r) => r.clientId).filter(isNonEmptyString)
}

async function getTimeOverlapClientIds(args: {
  professionalId: string
  startAt: Date
  endAt: Date | null
  now: Date
}): Promise<string[]> {
  const openingEnd = args.endAt ?? new Date(args.startAt.getTime() + 60 * 60 * 1000)

  const rows = await prisma.booking.findMany({
    where: {
      professionalId: args.professionalId,
      scheduledFor: { lt: openingEnd },
      NOT: { status: BookingStatus.CANCELLED },
    },
    select: {
      clientId: true,
      scheduledFor: true,
      totalDurationMinutes: true,
    },
    take: 5000,
  })

  const conflictIds = new Set<string>()
  for (const row of rows) {
    const bookingEnd = new Date(
      row.scheduledFor.getTime() + (row.totalDurationMinutes ?? 60) * 60 * 1000,
    )
    if (bookingEnd > args.startAt && row.scheduledFor < openingEnd) {
      conflictIds.add(row.clientId)
    }
  }

  return [...conflictIds]
}

function entryMatchesOpening(
  entry: {
    preferenceType: WaitlistPreferenceType
    specificDate: Date | null
    timeOfDay: string | null
    windowStartMin: number | null
    windowEndMin: number | null
  },
  openingStartAt: Date,
  openingTimeZone: string,
): boolean {
  if (!isValidIanaTimeZone(openingTimeZone)) return false

  if (entry.preferenceType === WaitlistPreferenceType.ANY_TIME) return true

  if (entry.preferenceType === WaitlistPreferenceType.TIME_OF_DAY) {
    if (!entry.timeOfDay) return false
    const hour = getZonedParts(openingStartAt, openingTimeZone).hour
    if (entry.timeOfDay === 'MORNING' && hour < 12) return true
    if (entry.timeOfDay === 'AFTERNOON' && hour >= 12 && hour < 17) return true
    if (entry.timeOfDay === 'EVENING' && hour >= 17) return true
    return false
  }

  if (entry.preferenceType === WaitlistPreferenceType.SPECIFIC_DATE) {
    if (!entry.specificDate) return false
    const oParts = getZonedParts(openingStartAt, openingTimeZone)
    const sParts = getZonedParts(entry.specificDate, openingTimeZone)
    return oParts.year === sParts.year && oParts.month === sParts.month && oParts.day === sParts.day
  }

  if (entry.windowStartMin != null && entry.windowEndMin != null) {
    const parts = getZonedParts(openingStartAt, openingTimeZone)
    const minute = parts.hour * 60 + parts.minute
    return minute >= entry.windowStartMin && minute < entry.windowEndMin
  }

  return false
}
