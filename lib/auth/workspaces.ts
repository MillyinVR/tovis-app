// lib/auth/workspaces.ts
//
// Workspace (role) capability resolution for the "switch workspace" feature.
//
// The DB `User.role` is the user's PERMANENT home role. A user may *act as*
// another workspace within a session (the acting role rides in the signed
// JWT — see lib/currentUser.ts). These pure helpers answer "which workspaces
// is this user entitled to?" from stable DB data, so both getCurrentUser (when
// validating an acting role) and the switch endpoint (when authorizing a
// switch) share one source of truth.
//
// Entitlement rules:
//   ADMIN  — if the home role is ADMIN, OR the user holds a global SUPER_ADMIN
//            grant (an AdminPermission row). The grant is the deliberate act of
//            provisioning; acting-as alone never conjures it. This lets a pro
//            (home role PRO) who is also a super admin switch into the console
//            without giving up Pro as their home workspace.
//   PRO    — only with an APPROVED ProfessionalProfile (i.e. licensed).
//   CLIENT — anyone; a missing ClientProfile is provisioned on first switch.

import type { Role, VerificationStatus } from '@prisma/client'

/** Structural input — avoids importing CurrentUser (would create a cycle). */
export type WorkspaceCapabilityUser = {
  /** The permanent DB role (NOT the acting role). */
  homeRole: Role
  clientProfile: { id: string } | null
  professionalProfile: { verificationStatus: VerificationStatus } | null
  /**
   * Whether the user holds a global SUPER_ADMIN grant. Lets a non-ADMIN home
   * role reach the Admin console workspace (see the ADMIN entitlement rule).
   */
  hasAdminGrant: boolean
}

/**
 * Structural view of a resolved CurrentUser carrying just the fields needed to
 * derive workspace capability. Kept structural (not `Pick<CurrentUser>`) so this
 * module never imports currentUser.ts and creates a cycle.
 */
export type WorkspaceCapabilitySource = {
  homeRole: Role
  clientProfile: { id: string } | null
  professionalProfile: { verificationStatus: VerificationStatus } | null
  canAccessAdmin: boolean
}

/** Extract the stable capability inputs from a resolved CurrentUser. */
export function workspaceCapabilityOf(
  user: WorkspaceCapabilitySource,
): WorkspaceCapabilityUser {
  return {
    homeRole: user.homeRole,
    clientProfile: user.clientProfile,
    professionalProfile: user.professionalProfile,
    hasAdminGrant: user.canAccessAdmin,
  }
}

/** Serializable description of a switchable workspace (safe to pass server→client). */
export type WorkspaceOption = {
  role: Role
  label: string
  sub: string
  href: string
  current: boolean
}

/** Landing route entered when a user switches into each workspace. */
export const WORKSPACE_HOME: Record<Role, string> = {
  CLIENT: '/client',
  PRO: '/pro/calendar',
  ADMIN: '/admin',
}

const WORKSPACE_META: Record<Role, { label: string; sub: string }> = {
  ADMIN: { label: 'Admin', sub: 'Console' },
  PRO: { label: 'Pro studio', sub: 'Manage bookings' },
  CLIENT: { label: 'Client', sub: 'Browse & book' },
}

/** Human label for a workspace (e.g. for "Switch to {label} to continue"). */
export function workspaceLabel(role: Role): string {
  return WORKSPACE_META[role].label
}

// Display order (also the order shown in the switcher sheet).
const WORKSPACE_ORDER: Role[] = ['ADMIN', 'PRO', 'CLIENT']

export function canActAs(user: WorkspaceCapabilityUser, role: Role): boolean {
  switch (role) {
    case 'ADMIN':
      return user.homeRole === 'ADMIN' || user.hasAdminGrant
    case 'PRO':
      return user.professionalProfile?.verificationStatus === 'APPROVED'
    case 'CLIENT':
      return true
    default:
      return false
  }
}

/** Every workspace the user is entitled to act in, in display order. */
export function listAvailableWorkspaces(user: WorkspaceCapabilityUser): Role[] {
  return WORKSPACE_ORDER.filter((role) => canActAs(user, role))
}

/**
 * Build the serializable switcher options. `currentRole` is the role the user
 * is acting in right now (so the sheet can mark it Active). Returns an empty
 * array when there's only one workspace — callers should hide the switcher.
 */
export function buildWorkspaceOptions(
  user: WorkspaceCapabilityUser,
  currentRole: Role,
): WorkspaceOption[] {
  const roles = listAvailableWorkspaces(user)
  if (roles.length <= 1) return []

  return roles.map((role) => ({
    role,
    label: WORKSPACE_META[role].label,
    sub: WORKSPACE_META[role].sub,
    href: WORKSPACE_HOME[role],
    current: role === currentRole,
  }))
}
