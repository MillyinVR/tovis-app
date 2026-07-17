// lib/dto/messaging.ts
//
// Wire DTOs for the messaging endpoints (GET /api/v1/messages/threads,
// GET/POST /api/v1/messages/threads/[id], POST /api/v1/messages/resolve,
// GET /api/v1/messages/unread-count).
//
// These routes query Prisma rows whose timestamps are Date objects; the routes
// serialize them to ISO strings at the return site (declared `string` here,
// enforced via `satisfies`). Preview name/avatar fields are typed `string | null`
// to safely cover whichever nullability the underlying profile column has.

import type { MediaType, MessageThreadContextType } from '@prisma/client'

export type MessageThreadClientPreviewDTO = {
  id: string
  firstName: string | null
  lastName: string | null
  avatarUrl: string | null
}

export type MessageThreadProfessionalPreviewDTO = {
  id: string
  businessName: string | null
  /**
   * Server-resolved public display name honoring the pro's `nameDisplay` toggle
   * (business name / real name / @handle). Emitted so iOS renders it verbatim;
   * raw first/last names are never placed on the wire.
   */
  displayName: string
  avatarUrl: string | null
}

export type MessageThreadParticipantReadDTO = {
  lastReadAt: string | null // ISO-8601
}

// GET /api/v1/messages/threads — one row in the thread list.
export type MessageThreadListItemDTO = {
  id: string
  contextType: MessageThreadContextType
  contextId: string
  bookingId: string | null
  serviceId: string | null
  offeringId: string | null
  waitlistEntryId: string | null
  lastMessageAt: string | null // ISO-8601
  lastMessagePreview: string | null
  updatedAt: string // ISO-8601
  client: MessageThreadClientPreviewDTO
  professional: MessageThreadProfessionalPreviewDTO
  participants: MessageThreadParticipantReadDTO[]
  /**
   * Whether the viewer is this thread's professional (derived from the viewer's
   * user id, not their acting role — so dual-role users and admins never resolve
   * to their own name). The counterparty is the client when true, the pro when
   * false. The list payload omits participant user ids, so this is the client's
   * only signal for picking whose name/avatar to show.
   */
  isViewerPro: boolean
  /**
   * Server-computed context label for the row's eyebrow, e.g.
   * "BOOKING CONFIRMED — Balayage — Fri 2:00 PM", "Waitlist — Position active",
   * "Service — Color". Always present (falls back to "Message"). Computed once
   * server-side so web + iOS render identical copy without duplicating the
   * booking/waitlist/service lookups.
   */
  eyebrow: string
  /** Whether the eyebrow renders in the accent tone (actionable context). */
  isAccentContext: boolean
  _count: { messages: number }
}

export type MessagesThreadsListResponseDTO = {
  threads: MessageThreadListItemDTO[]
}

export type MessageAttachmentDTO = {
  id: string
  url: string
  mediaType: MediaType
}

// A message as returned by the thread message list (carries attachments).
export type MessageDTO = {
  id: string
  body: string | null
  createdAt: string // ISO-8601
  senderUserId: string
  attachments: MessageAttachmentDTO[]
}

// GET /api/v1/messages/threads/[id]
export type MessageThreadMessagesResponseDTO = {
  thread: {
    id: string
    /** See MessageThreadListItemDTO.isViewerPro. */
    isViewerPro: boolean
    /**
     * The counterparty's last-read timestamp (ISO-8601), or null if they haven't
     * read the thread. Drives the sender's read receipt: an outgoing message is
     * "Read" once this is >= the message's createdAt. Updated on each poll.
     */
    counterpartyLastReadAt: string | null
  }
  messages: MessageDTO[]
  nextCursor: string | null
  hasMore: boolean
  take: number
}

// POST /api/v1/messages/threads/[id] — the created message. Carries its
// attachments (with freshly-signed render URLs) so the sender can render an
// image message immediately without waiting for the next poll.
export type CreatedMessageDTO = {
  id: string
  body: string | null
  createdAt: string // ISO-8601
  senderUserId: string
  attachments: MessageAttachmentDTO[]
}

// POST /api/v1/messages/threads/[id]/uploads — a presigned, thread-scoped,
// media-private upload target for a message image attachment. The client PUTs
// the bytes to `signedUrl` (Supabase signed upload), then POSTs the message
// with `path` in its `attachments`. `path` is namespaced under the thread so the
// send route can prove the attachment belongs to this conversation.
export type MessageUploadInitDTO = {
  bucket: string
  path: string
  token: string
  signedUrl: string | null
}

export type CreateMessageResponseDTO = {
  message: CreatedMessageDTO
}

// POST /api/v1/messages/resolve
export type ResolveThreadResponseDTO = {
  thread: { id: string } | null
}

// GET /api/v1/messages/unread-count — `badge` omitted when count <= 0.
export type MessagesUnreadCountResponseDTO = {
  count: number
  badge?: string
}
