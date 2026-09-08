import {
  FounderAudience,
  FounderMemberStatus,
  FounderRoomKey,
  FounderSpecialty,
} from '@prisma/client'

export type FounderRoomDefinition = {
  key: FounderRoomKey
  label: string
  description: string
  audience: FounderAudience
}

export const FOUNDER_ROOM_CATALOG: readonly FounderRoomDefinition[] = [
  {
    key: FounderRoomKey.PRO_ALL,
    label: 'All Founding Pros',
    description: 'The shared room for every founding professional.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_HAIR,
    label: 'Hair Professionals',
    description: 'Color, cutting, styling, and hair-service feedback.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_NAILS,
    label: 'Nail Professionals',
    description: 'Nail services, design, detail capture, and client flow.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_LASHES_BROWS,
    label: 'Lash & Brow Professionals',
    description: 'Lash and brow services, maintenance, and close-up capture.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_SKINCARE,
    label: 'Skincare Professionals',
    description: 'Facials, skin goals, treatment plans, and follow-up.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_MAKEUP,
    label: 'Makeup Professionals',
    description: 'Event, bridal, and everyday makeup experiences.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_PERMANENT_MAKEUP,
    label: 'Permanent Makeup Professionals',
    description: 'Healed results, touch-ups, consent, and preparation.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_EXTENSIONS,
    label: 'Extensions Professionals',
    description: 'Extension planning, maintenance, matching, and results.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_WAXING_SPRAY_TAN,
    label: 'Waxing & Spray Tan Professionals',
    description: 'Preparation, service experience, and aftercare feedback.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.PRO_BARBER,
    label: 'Barbers',
    description: 'Cuts, grooming, repeat cadence, and barber workflows.',
    audience: FounderAudience.PRO,
  },
  {
    key: FounderRoomKey.CLIENT_ONE,
    label: 'Client Circle 1',
    description: 'A private feedback room for each pro’s first founding client.',
    audience: FounderAudience.CLIENT,
  },
  {
    key: FounderRoomKey.CLIENT_TWO,
    label: 'Client Circle 2',
    description: 'A private feedback room for each pro’s second founding client.',
    audience: FounderAudience.CLIENT,
  },
  {
    key: FounderRoomKey.CLIENT_THREE,
    label: 'Client Circle 3',
    description: 'A private feedback room for each pro’s third founding client.',
    audience: FounderAudience.CLIENT,
  },
] as const

const ROOM_BY_KEY = new Map(
  FOUNDER_ROOM_CATALOG.map((room) => [room.key, room]),
)

const SPECIALTY_ROOM: Record<FounderSpecialty, FounderRoomKey> = {
  [FounderSpecialty.HAIR]: FounderRoomKey.PRO_HAIR,
  [FounderSpecialty.NAILS]: FounderRoomKey.PRO_NAILS,
  [FounderSpecialty.LASHES_BROWS]: FounderRoomKey.PRO_LASHES_BROWS,
  [FounderSpecialty.SKINCARE]: FounderRoomKey.PRO_SKINCARE,
  [FounderSpecialty.MAKEUP]: FounderRoomKey.PRO_MAKEUP,
  [FounderSpecialty.PERMANENT_MAKEUP]: FounderRoomKey.PRO_PERMANENT_MAKEUP,
  [FounderSpecialty.EXTENSIONS]: FounderRoomKey.PRO_EXTENSIONS,
  [FounderSpecialty.WAXING_SPRAY_TAN]: FounderRoomKey.PRO_WAXING_SPRAY_TAN,
  [FounderSpecialty.BARBER]: FounderRoomKey.PRO_BARBER,
}

const CLIENT_SLOT_ROOM: Record<1 | 2 | 3, FounderRoomKey> = {
  1: FounderRoomKey.CLIENT_ONE,
  2: FounderRoomKey.CLIENT_TWO,
  3: FounderRoomKey.CLIENT_THREE,
}

export function founderRoomDefinition(
  key: FounderRoomKey,
): FounderRoomDefinition {
  const room = ROOM_BY_KEY.get(key)
  if (!room) throw new Error(`Unknown founder room: ${key}`)
  return room
}

export function founderRoomForSpecialty(
  specialty: FounderSpecialty,
): FounderRoomKey {
  return SPECIALTY_ROOM[specialty]
}

export function founderRoomForClientSlot(slot: number): FounderRoomKey | null {
  if (slot !== 1 && slot !== 2 && slot !== 3) return null
  return CLIENT_SLOT_ROOM[slot]
}

export function isFounderRoomKey(value: unknown): value is FounderRoomKey {
  return (
    typeof value === 'string' &&
    Object.values(FounderRoomKey).some((room) => room === value)
  )
}

export type FounderRoomMember = {
  audience: FounderAudience
  status: FounderMemberStatus
  specialty: FounderSpecialty | null
  clientSlot: number | null
}

/**
 * The one authoritative member-to-room rule. Web and iOS receive its output
 * from the portal API and never recreate these eligibility rules locally.
 */
export function founderRoomsForMember(
  member: FounderRoomMember,
): FounderRoomKey[] {
  if (member.status !== FounderMemberStatus.ACTIVE) return []

  if (member.audience === FounderAudience.PRO && member.specialty) {
    return [
      FounderRoomKey.PRO_ALL,
      founderRoomForSpecialty(member.specialty),
    ]
  }

  if (member.audience === FounderAudience.CLIENT && member.clientSlot) {
    const room = founderRoomForClientSlot(member.clientSlot)
    return room ? [room] : []
  }

  return []
}
