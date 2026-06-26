// lib/currentUser.ts
//
// AuthVersion invariant:
// - Every authenticated server route/page must reach current-user auth through
//   getCurrentUser(), usually via requireUser()/requireClient()/requirePro().
// - Middleware can validate JWT signature/session kind, but it cannot
//   DB-verify authVersion in the Edge runtime.
// - This file is the source of truth for DB-backed authVersion validation.
//   If a route reads JWT/session state directly and skips this path, session
//   revocation flows (sign out everywhere, password reset, authVersion bump)
//   can be bypassed.

import { Prisma, type Role } from '@prisma/client'
import { cookies, headers } from 'next/headers'

import { type AuthSessionKind, type AuthRole, verifyToken } from './auth'
import { parseBearerToken } from './auth/bearerToken'
import { canActAs } from './auth/workspaces'
import { prisma } from './prisma'

export const currentUserSelect = {
  id: true,
  email: true,
  phone: true,
  role: true,
  authVersion: true,
  createdAt: true,
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
      firstName: true,
      lastName: true,
      handle: true,
      nameDisplay: true,
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
  /**
   * The workspace the user is acting in right now. Equals `homeRole` unless the
   * user has switched workspaces (the acting role rides in the JWT and is only
   * honored when still entitled — see resolveActingRole). All role gating reads
   * this field, so a switch takes effect everywhere.
   */
  role: Role
  /** The permanent DB role — the user's home workspace and entitlement anchor. */
  homeRole: Role
  sessionKind: AuthSessionKind
  isPhoneVerified: boolean
  isEmailVerified: boolean
  isFullyVerified: boolean
}

/**
 * Resolve the role the user is acting as. The token may carry a different role
 * than the DB home role (set by the workspace-switch endpoint); honor it only
 * if the user is still entitled to it, otherwise fall back to the home role.
 * This re-checks entitlement on every request, so a revoked capability (e.g. a
 * pro license downgraded after switching) safely drops the user back home.
 */
function resolveActingRole(
  user: CurrentUserRecord,
  tokenRole: AuthRole,
): Role {
  if (tokenRole === user.role) return user.role
  return canActAs(
    {
      homeRole: user.role,
      clientProfile: user.clientProfile,
      professionalProfile: user.professionalProfile,
    },
    tokenRole,
  )
    ? tokenRole
    : user.role
}

function toCurrentUser(
  user: CurrentUserRecord,
  sessionKind: AuthSessionKind,
  actingRole: Role,
): CurrentUser {
  const isPhoneVerified = Boolean(user.phoneVerifiedAt)
  const isEmailVerified = Boolean(user.emailVerifiedAt)

  return {
    ...user,
    role: actingRole,
    homeRole: user.role,
    sessionKind,
    isPhoneVerified,
    isEmailVerified,
    isFullyVerified: isPhoneVerified && isEmailVerified,
  }
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies()
  // Web delivers the session as the httpOnly `tovis_token` cookie. Native
  // clients have no cookie jar, so fall back to an `Authorization: Bearer`
  // header. The token, verification, role and authVersion-revocation logic
  // below is identical regardless of transport.
  let token = cookieStore.get('tovis_token')?.value ?? null

  if (!token) {
    const headerStore = await headers()
    token = parseBearerToken(headerStore.get('authorization'))
  }

  if (!token) return null

  const payload = verifyToken(token)
  if (!payload) return null

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: currentUserSelect,
  })

  if (!user) return null
  if (user.authVersion !== payload.authVersion) return null

  const actingRole = resolveActingRole(user, payload.role)
  return toCurrentUser(user, payload.sessionKind, actingRole)
}