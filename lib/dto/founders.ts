import type {
  FounderAudience,
  FounderMemberRole,
  FounderMessageKind,
  FounderMessageReportReason,
  FounderRoomKey,
  FounderSpecialty,
} from '@prisma/client'

export type FounderRoomDTO = {
  key: FounderRoomKey
  label: string
  description: string
  audience: FounderAudience
  unreadCount: number
}

export type FounderPortalDTO = {
  canModerate: boolean
  canAdminister: boolean
  isOwner: boolean
  rooms: FounderRoomDTO[]
}

export type FounderMessageAuthorDTO = {
  id: string
  displayName: string
  avatarUrl: string | null
  audience: FounderAudience | 'ADMIN'
  role: FounderMemberRole | 'ADMIN'
}

export type FounderMessageDTO = {
  id: string
  room: FounderRoomKey
  kind: FounderMessageKind
  body: string
  createdAt: string
  answeredAt: string | null
  replyToId: string | null
  author: FounderMessageAuthorDTO
}

export type FounderMessagesResponseDTO = {
  room: FounderRoomDTO
  messages: FounderMessageDTO[]
  nextCursor: string | null
  hasMore: boolean
}

export type FounderMessageCreateResponseDTO = {
  message: FounderMessageDTO
}

export type FounderMessageReportDTO = {
  id: string
  reason: FounderMessageReportReason
  details: string | null
  createdAt: string
  message: FounderMessageDTO
}

export type FounderMessageReportCreateResponseDTO = {
  reportId: string
}

export type FounderAdminMemberDTO = {
  id: string
  userId: string
  displayName: string
  audience: FounderAudience
  role: FounderMemberRole
  specialty: FounderSpecialty | null
  clientSlot: number | null
  sponsorName: string | null
  joinedAt: string
  removedAt: string | null
}

export type FounderAdminSummaryDTO = {
  proSeatsUsed: number
  proSeatsRemaining: number
  activeClients: number
  unansweredQuestions: number
  openReports: number
  reports: FounderMessageReportDTO[]
  members: FounderAdminMemberDTO[]
}
