// lib/dto/clientMe.ts
//
// JSON-safe serializer for the client "Me" aggregate screen. Wraps the SAME
// loader the server-rendered /client/me page uses (loadClientMePage). Most of
// that payload is already JSON-safe — boards/following are pre-mapped DTOs,
// history/upcomingNotificationBooking come from buildClientBookingDTO, and the
// creator remixes are already serialized. This only converts the remaining raw
// Prisma rows (the signed-in user + the client profile) whose Date columns are
// not JSON-safe, and narrows the user object to the client-facing fields.
import type { ClientBookingDTO } from '@/lib/dto/clientBooking'
import type { ClientMePageData } from '@/app/client/(gated)/me/_data/loadClientMePage'

export type ClientMeUserDTO = {
  id: string
  email: string | null
  phone: string | null
  role: string
  createdAt: string
  phoneVerifiedAt: string | null
  emailVerifiedAt: string | null
  clientProfile: {
    id: string
    firstName: string | null
    lastName: string | null
    avatarUrl: string | null
    phoneVerifiedAt: string | null
  } | null
}

export type ClientMeProfileDTO = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  avatarUrl: string | null
  claimStatus: string
  claimedAt: string | null
  handle: string | null
  isPublicProfile: boolean
}

export type ClientMeHistoryItemDTO = {
  kind: 'completed' | 'upcoming'
  label: 'BOOKED' | 'UPCOMING'
  booking: ClientBookingDTO
  heroImageUrl: string | null
}

export type ClientMePageDTO = {
  user: ClientMeUserDTO
  profile: ClientMeProfileDTO
  boards: ClientMePageData['boards']
  following: ClientMePageData['following']
  counts: ClientMePageData['counts']
  upcomingNotificationBooking: ClientBookingDTO | null
  history: ClientMeHistoryItemDTO[]
  myLooks: ClientMePageData['myLooks']
  activityUnreadCount: number
  creator: ClientMePageData['creator']
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function serializeUser(user: ClientMePageData['user']): ClientMeUserDTO {
  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    phoneVerifiedAt: iso(user.phoneVerifiedAt),
    emailVerifiedAt: iso(user.emailVerifiedAt),
    clientProfile: user.clientProfile
      ? {
          id: user.clientProfile.id,
          firstName: user.clientProfile.firstName ?? null,
          lastName: user.clientProfile.lastName ?? null,
          avatarUrl: user.clientProfile.avatarUrl ?? null,
          phoneVerifiedAt: iso(user.clientProfile.phoneVerifiedAt),
        }
      : null,
  }
}

function serializeProfile(
  profile: ClientMePageData['profile'],
): ClientMeProfileDTO {
  return {
    id: profile.id,
    firstName: profile.firstName ?? null,
    lastName: profile.lastName ?? null,
    email: profile.email ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    claimStatus: profile.claimStatus,
    claimedAt: iso(profile.claimedAt),
    handle: profile.handle ?? null,
    isPublicProfile: profile.isPublicProfile,
  }
}

export function serializeClientMePageData(
  data: ClientMePageData,
): ClientMePageDTO {
  return {
    user: serializeUser(data.user),
    profile: serializeProfile(data.profile),
    boards: data.boards,
    following: data.following,
    counts: data.counts,
    upcomingNotificationBooking: data.upcomingNotificationBooking,
    history: data.history.map((item) => ({
      kind: item.kind,
      label: item.label,
      booking: item.booking,
      heroImageUrl: item.heroImageUrl,
    })),
    myLooks: data.myLooks,
    activityUnreadCount: data.activityUnreadCount,
    creator: data.creator,
  }
}
