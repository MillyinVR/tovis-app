// lib/currentUser.ts

import { Prisma } from '@prisma/client'
import { cookies } from 'next/headers'

import { type AuthSessionKind, verifyToken } from './auth'
import { prisma } from './prisma'

export const currentUserSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  authVersion: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,

  clientProfile: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      phoneVerifiedAt: true,
    },
  },

  professionalProfile: {
    select: {
      id: true,
      businessName: true,
      handle: true,
      avatarUrl: true,
      timeZone: true,
      location: true,
      phoneVerifiedAt: true,
      verificationStatus: true,
    },
  },
} satisfies Prisma.UserSelect

type CurrentUserRecord = Prisma.UserGetPayload<{
  select: typeof currentUserSelect
}>

export type CurrentUser = CurrentUserRecord & {
  sessionKind: AuthSessionKind
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
}

function toCurrentUser(
  user: CurrentUserRecord,
  sessionKind: AuthSessionKind,
): CurrentUser {
  const isPhoneVerified = Boolean(user.phoneVerifiedAt)
  const isEmailVerified = Boolean(user.emailVerifiedAt)

  return {
    ...user,
    sessionKind,
    isPhoneVerified,
    isEmailVerified,
    isFullyVerified: isPhoneVerified && isEmailVerified,
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('tovis_token')?.value ?? null

  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: currentUserSelect,
  })

  if (!user) return null
  if (user.authVersion !== payload.authVersion) return null

  return toCurrentUser(user, payload.sessionKind)
}