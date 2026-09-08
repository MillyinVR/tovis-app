import {
  FounderMemberRole,
  FounderMemberStatus,
  FounderRoomKey,
} from '@prisma/client'

import type { CurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import {
  FOUNDER_ROOM_CATALOG,
  founderRoomsForMember,
} from '@/lib/founders/rooms'

export type FounderPortalAccess = {
  canAccess: boolean
  canModerate: boolean
  canAdminister: boolean
  isOwner: boolean
  rooms: FounderRoomKey[]
  memberId: string | null
}

const NO_ACCESS: FounderPortalAccess = {
  canAccess: false,
  canModerate: false,
  canAdminister: false,
  isOwner: false,
  rooms: [],
  memberId: null,
}

export async function resolveFounderPortalAccess(
  user: CurrentUser,
): Promise<FounderPortalAccess> {
  const member = await prisma.founderMember.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      audience: true,
      role: true,
      status: true,
      specialty: true,
      clientSlot: true,
    },
  })

  const isOwner = member?.role === FounderMemberRole.OWNER
  const canAdminister = user.canAccessAdmin || isOwner
  const canModerate =
    canAdminister || member?.role === FounderMemberRole.MODERATOR

  // Global admins and the portal owner see all rooms from any acting workspace.
  if (canAdminister) {
    return {
      canAccess: true,
      canModerate: true,
      canAdminister: true,
      isOwner,
      rooms: FOUNDER_ROOM_CATALOG.map((room) => room.key),
      memberId: member?.id ?? null,
    }
  }

  if (!member || member.status !== FounderMemberStatus.ACTIVE) return NO_ACCESS

  const rooms = founderRoomsForMember(member)
  if (rooms.length) {
    return {
      canAccess: true,
      canModerate,
      canAdminister: false,
      isOwner: false,
      rooms,
      memberId: member.id,
    }
  }

  return NO_ACCESS
}

export function canAccessFounderRoom(
  access: FounderPortalAccess,
  room: FounderRoomKey,
): boolean {
  return access.canAccess && access.rooms.includes(room)
}
