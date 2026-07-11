// lib/dto/clientAftercareInbox.ts
//
// Wire (output) shape for the client aftercare inbox list:
//   GET /api/v1/client/aftercare → ClientAftercareInboxDTO
//
// The inbox is the client's AFTERCARE_READY notification feed, enriched with
// each visit's canonical title, pro display name, timezone, and before/after
// pair. House rule: Prisma is the single source of truth for data shapes — these
// fields are derived from the `ClientNotification` + `Booking` rows by the shared
// loader (lib/aftercare/loadClientAftercareInbox), with Date columns rendered to
// ISO strings so this is a JSON-safe wire shape, not a raw row.
import type { AftercareRebookMode } from '@prisma/client'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'

export type ClientAftercareInboxItemDTO = {
  /** The AFTERCARE_READY notification id (stable list key). */
  notificationId: string
  /** The visit this aftercare belongs to; null if the notification lost its link. */
  bookingId: string | null
  /** The AftercareSummary id, when present on the notification. */
  aftercareId: string | null
  /** Canonical booking title (service + add-ons), or a fallback. */
  title: string
  /** The pro's profile id for a profile deep-link, or null. */
  proId: string | null
  /** The pro's public display name (honors nameDisplay), or "Your pro". */
  proName: string
  /** The visit instant (ISO), or null. */
  scheduledFor: string | null
  /** The booking's sanitized IANA timezone for rendering `scheduledFor`. */
  timeZone: string
  /** The pro-chosen (or earliest) before/after pair, or null when none. */
  beforeAfter: BookingBeforeAfterThumbs | null
  /** The aftercare rebook mode, driving the row hint; null when unset. */
  rebookMode: AftercareRebookMode | null
  /** The pro's recommended rebook date (ISO), when set. */
  rebookedFor: string | null
  /** The notification body copy the pro wrote, or null. */
  body: string | null
  /** True while the client hasn't opened this aftercare (drives the NEW pill). */
  unread: boolean
  /** When the aftercare landed in the inbox (ISO). */
  createdAt: string
}

export type ClientAftercareInboxDTO = {
  items: ClientAftercareInboxItemDTO[]
}
