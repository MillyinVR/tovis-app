// lib/migration/calendarFeedSubscription.ts
//
// Manage a pro's persistent calendar feed subscription (one per pro). The pro
// connects a read-only iCal feed URL once; the resync cron keeps it in sync
// during the transition. URLs are validated/normalized through the same SSRF
// front door as the one-shot fetch.

import { CalendarFeedStatus, Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

import { normalizeFeedUrl } from './calendarFeed'

export type CalendarFeedSubscriptionDto = {
  feedUrl: string
  status: CalendarFeedStatus
  lastSyncedAt: string | null
  lastSyncError: string | null
}

const SUBSCRIPTION_SELECT = {
  feedUrl: true,
  status: true,
  lastSyncedAt: true,
  lastSyncError: true,
} satisfies Prisma.CalendarFeedSubscriptionSelect

function toDto(row: {
  feedUrl: string
  status: CalendarFeedStatus
  lastSyncedAt: Date | null
  lastSyncError: string | null
}): CalendarFeedSubscriptionDto {
  return {
    feedUrl: row.feedUrl,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastSyncError: row.lastSyncError,
  }
}

export async function getCalendarFeedSubscription(
  professionalId: string,
): Promise<CalendarFeedSubscriptionDto | null> {
  const row = await prisma.calendarFeedSubscription.findUnique({
    where: { professionalId },
    select: SUBSCRIPTION_SELECT,
  })
  return row ? toDto(row) : null
}

export type SaveCalendarFeedSubscriptionResult =
  | { ok: true; subscription: CalendarFeedSubscriptionDto }
  | { ok: false; error: string }

// Connect (or update) the feed. Validates the URL through normalizeFeedUrl
// (https/webcal only) and stores the normalized form; reactivates a paused one.
export async function saveCalendarFeedSubscription(args: {
  professionalId: string
  feedUrl: string
}): Promise<SaveCalendarFeedSubscriptionResult> {
  const normalized = normalizeFeedUrl(args.feedUrl)
  if (!normalized) {
    return { ok: false, error: 'Enter a valid https calendar feed URL.' }
  }
  const feedUrl = normalized.toString()

  const row = await prisma.calendarFeedSubscription.upsert({
    where: { professionalId: args.professionalId },
    create: { professionalId: args.professionalId, feedUrl, status: CalendarFeedStatus.ACTIVE },
    update: { feedUrl, status: CalendarFeedStatus.ACTIVE, lastSyncError: null },
    select: SUBSCRIPTION_SELECT,
  })
  return { ok: true, subscription: toDto(row) }
}

// Disconnect: stop resyncing but keep the row (history). No-op if none exists.
export async function disconnectCalendarFeedSubscription(
  professionalId: string,
): Promise<void> {
  await prisma.calendarFeedSubscription.updateMany({
    where: { professionalId },
    data: { status: CalendarFeedStatus.PAUSED },
  })
}
