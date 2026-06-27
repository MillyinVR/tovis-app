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
  lastMessageAt: string | null // ISO-8601
  lastMessagePreview: string | null
  updatedAt: string // ISO-8601
  client: MessageThreadClientPreviewDTO
  professional: MessageThreadProfessionalPreviewDTO
  participants: MessageThreadParticipantReadDTO[]
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
  thread: { id: string }
  messages: MessageDTO[]
  nextCursor: string | null
  hasMore: boolean
  take: number
}

// POST /api/v1/messages/threads/[id] — created message (no attachments projected).
export type CreatedMessageDTO = {
  id: string
  body: string | null
  createdAt: string // ISO-8601
  senderUserId: string
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
