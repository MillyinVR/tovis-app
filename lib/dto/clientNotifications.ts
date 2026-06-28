// lib/dto/clientNotifications.ts
//
// Wire (output) shapes for the client notification surface:
//   GET  /api/v1/client/notifications          → ClientNotificationListDTO
//   GET  /api/v1/client/notifications/summary   → ClientNotificationSummaryDTO
//   POST /api/v1/client/notifications/read       → ClientNotificationsReadResponseDTO
//
// (The preferences GET/PATCH shape is the already-JSON-safe
// `NotificationPreferencesPayload` from lib/notifications/preferenceService,
// re-exported through lib/dto/index.ts.)
//
// House rule: Prisma is the single source of truth for data shapes. These DTOs
// derive from the `ClientNotification` row via the route mapper — Date columns
// become ISO strings here, so they are JSON-safe wire shapes, not raw rows.
import type { NotificationEventKey } from '@prisma/client'

export type ClientNotificationDTO = {
  id: string
  eventKey: NotificationEventKey
  title: string
  body: string | null
  /** Internal deep-link path (e.g. "/client/bookings/bk_1"); "" when none. */
  href: string
  /** Structured, event-specific metadata. Non-object payloads serialize to null. */
  data: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  /** ISO timestamp when the client read it, or null while unread. */
  readAt: string | null
  bookingId: string | null
  aftercareId: string | null
}

export type ClientNotificationFiltersDTO = {
  unreadOnly: boolean
  eventKey: NotificationEventKey | null
}

export type ClientNotificationListDTO = {
  items: ClientNotificationDTO[]
  /** Opaque cursor for the next page, or null when the feed is exhausted. */
  nextCursor: string | null
  filters: ClientNotificationFiltersDTO
}

export type ClientNotificationSummaryDTO = {
  pendingUnreadCount: number
  aftercareUnreadCount: number
  upcomingUnreadCount: number
  hasAnyUnreadUpdates: boolean
}

export type ClientNotificationsReadResponseDTO = {
  count: number
}
