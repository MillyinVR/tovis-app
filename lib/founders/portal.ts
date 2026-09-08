import {
  FounderAudience,
  type Prisma,
} from '@prisma/client'

import type {
  FounderMessageAuthorDTO,
  FounderMessageDTO,
  FounderPortalDTO,
} from '@/lib/dto/founders'
import type { FounderPortalAccess } from '@/lib/founders/access'
import { founderRoomDefinition } from '@/lib/founders/rooms'
import { prisma } from '@/lib/prisma'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

export const FOUNDER_MESSAGE_PAGE_SIZE = 50

export const FOUNDER_MESSAGE_SELECT = {
  id: true,
  room: true,
  kind: true,
  body: true,
  createdAt: true,
  answeredAt: true,
  replyToId: true,
  sender: {
    select: {
      id: true,
      role: true,
      founderMembership: {
        select: { audience: true, role: true },
      },
      clientProfile: {
        select: { firstName: true, lastName: true, avatarUrl: true },
      },
      professionalProfile: {
        select: {
          ...professionalPublicDisplayNameSelect,
          avatarUrl: true,
        },
      },
    },
  },
} satisfies Prisma.FounderMessageSelect

export type FounderMessageRow = Prisma.FounderMessageGetPayload<{
  select: typeof FOUNDER_MESSAGE_SELECT
}>

function clientDisplayName(
  client: { firstName: string | null; lastName: string | null } | null,
): string {
  const firstName = client?.firstName?.trim() ?? '' // pii-plaintext-read-ok: consented founder-community display identity
  const lastInitial = client?.lastName?.trim().charAt(0) ?? '' // pii-plaintext-read-ok: founder rooms intentionally disclose only an initial
  return [firstName, lastInitial ? `${lastInitial}.` : ''].filter(Boolean).join(' ') || 'Founding client'
}

export function founderMessageAuthor(
  sender: FounderMessageRow['sender'],
): FounderMessageAuthorDTO {
  const member = sender.founderMembership
  const isAdminWithoutMembership = !member && sender.role === 'ADMIN'

  if (member?.audience === FounderAudience.PRO) {
    return {
      id: sender.id,
      displayName: formatProfessionalPublicDisplayName(
        sender.professionalProfile,
        'Founding professional',
      ),
      avatarUrl: sender.professionalProfile?.avatarUrl ?? null,
      audience: member.audience,
      role: member.role,
    }
  }

  if (member?.audience === FounderAudience.CLIENT) {
    return {
      id: sender.id,
      displayName: clientDisplayName(sender.clientProfile),
      avatarUrl: sender.clientProfile?.avatarUrl ?? null,
      audience: member.audience,
      role: member.role,
    }
  }

  return {
    id: sender.id,
    displayName: isAdminWithoutMembership ? 'Founding Circle team' : 'Founder',
    avatarUrl:
      sender.professionalProfile?.avatarUrl ?? sender.clientProfile?.avatarUrl ?? null,
    audience: 'ADMIN',
    role: 'ADMIN',
  }
}

export function founderMessageDTO(row: FounderMessageRow): FounderMessageDTO {
  return {
    id: row.id,
    room: row.room,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    replyToId: row.replyToId,
    author: founderMessageAuthor(row.sender),
  }
}

export async function founderPortalDTO(
  userId: string,
  access: FounderPortalAccess,
): Promise<FounderPortalDTO> {
  const reads = await prisma.founderRoomRead.findMany({
    where: { userId, room: { in: access.rooms } },
    select: { room: true, lastReadAt: true },
  })
  const readByRoom = new Map(reads.map((read) => [read.room, read.lastReadAt]))

  const rooms = await Promise.all(
    access.rooms.map(async (key) => {
      const definition = founderRoomDefinition(key)
      const lastReadAt = readByRoom.get(key)
      const unreadCount = await prisma.founderMessage.count({
        where: {
          room: key,
          hiddenAt: null,
          senderUserId: { not: userId },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
      })
      return { ...definition, unreadCount }
    }),
  )

  return {
    canModerate: access.canModerate,
    canAdminister: access.canAdminister,
    isOwner: access.isOwner,
    rooms,
  }
}
