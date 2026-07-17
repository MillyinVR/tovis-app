// lib/dto/clientActivity.ts
//
// Wire (output) shape for the client "Activity" feed — the creator-engagement
// surface (distinct from the transactional booking inbox):
//   GET /api/v1/client/activity → ClientActivityFeedDTO
//
// This wraps the SAME loader the server-rendered /client/activity page uses
// (loadClientActivityPage), so the native feed and the web page cannot drift.
//
// Unlike lib/dto/clientMe.ts there is nothing to CONVERT here: the loader hands
// back presentation items from lib/notifications/activityFeed, which already
// emit JSON-safe values (`createdAt` becomes an ISO `timestamp` string) rather
// than raw Prisma rows. Those types therefore serve as the wire contract
// directly and are re-exported by lib/dto/index.ts. The serializer below still
// builds a fresh object rather than passing the loader's result through, so a
// field added for the page's benefit can never leak onto the wire unannounced.
import type { NotificationEventKey } from '@prisma/client'

import type { ClientActivityPageData } from '@/app/client/(gated)/activity/_data/loadClientActivityPage'
import type { ClientActivityItem } from '@/lib/notifications/activityFeed'

export type ClientActivityFeedDTO = {
  items: ClientActivityItem[]
  /** Unread activity events — the same count that badges the Me header bell. */
  unreadCount: number
  /** The event keys "Mark all read" should clear (the activity allowlist). */
  markReadEventKeys: NotificationEventKey[]
}

export function serializeClientActivityFeed(
  data: ClientActivityPageData,
): ClientActivityFeedDTO {
  return {
    items: data.items,
    unreadCount: data.unreadCount,
    markReadEventKeys: data.markReadEventKeys,
  }
}
