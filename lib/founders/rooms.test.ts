import { describe, expect, it } from 'vitest'
import {
  FounderAudience,
  FounderMemberStatus,
  FounderRoomKey,
  FounderSpecialty,
} from '@prisma/client'

import {
  FOUNDER_ROOM_CATALOG,
  founderRoomsForMember,
} from '@/lib/founders/rooms'

describe('founder room access source of truth', () => {
  it('contains nine industry rooms, one all-pro room, and three client rooms', () => {
    expect(FOUNDER_ROOM_CATALOG).toHaveLength(13)
    expect(
      FOUNDER_ROOM_CATALOG.filter((room) => room.key.startsWith('PRO_')),
    ).toHaveLength(10)
    expect(
      FOUNDER_ROOM_CATALOG.filter((room) => room.key.startsWith('CLIENT_')),
    ).toHaveLength(3)
  })

  it.each([
    [FounderSpecialty.HAIR, FounderRoomKey.PRO_HAIR],
    [FounderSpecialty.NAILS, FounderRoomKey.PRO_NAILS],
    [FounderSpecialty.LASHES_BROWS, FounderRoomKey.PRO_LASHES_BROWS],
    [FounderSpecialty.SKINCARE, FounderRoomKey.PRO_SKINCARE],
    [FounderSpecialty.MAKEUP, FounderRoomKey.PRO_MAKEUP],
    [
      FounderSpecialty.PERMANENT_MAKEUP,
      FounderRoomKey.PRO_PERMANENT_MAKEUP,
    ],
    [FounderSpecialty.EXTENSIONS, FounderRoomKey.PRO_EXTENSIONS],
    [
      FounderSpecialty.WAXING_SPRAY_TAN,
      FounderRoomKey.PRO_WAXING_SPRAY_TAN,
    ],
    [FounderSpecialty.BARBER, FounderRoomKey.PRO_BARBER],
  ])('gives a %s pro exactly the all-pro and matching industry rooms', (specialty, room) => {
    expect(
      founderRoomsForMember({
        audience: FounderAudience.PRO,
        status: FounderMemberStatus.ACTIVE,
        specialty,
        clientSlot: null,
      }),
    ).toEqual([FounderRoomKey.PRO_ALL, room])
  })

  it.each([
    [1, FounderRoomKey.CLIENT_ONE],
    [2, FounderRoomKey.CLIENT_TWO],
    [3, FounderRoomKey.CLIENT_THREE],
  ])('gives client slot %i exactly one client-only room', (clientSlot, room) => {
    expect(
      founderRoomsForMember({
        audience: FounderAudience.CLIENT,
        status: FounderMemberStatus.ACTIVE,
        specialty: null,
        clientSlot,
      }),
    ).toEqual([room])
  })

  it('gives removed members no rooms', () => {
    expect(
      founderRoomsForMember({
        audience: FounderAudience.PRO,
        status: FounderMemberStatus.REMOVED,
        specialty: FounderSpecialty.HAIR,
        clientSlot: null,
      }),
    ).toEqual([])
  })
})
