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
//   PRO    — with a ProfessionalProfile an admin has not REFUSED. A verified
//            licence is a badge, not a gate (lib/proTrustState.ts). Home-PRO is
//            unconditional on top of that: see the note on the PRO branch.
//   CLIENT — anyone; a missing ClientProfile is provisioned on first switch.

import type { Role, VerificationStatus } from '@prisma/client'

import { isBarredProStatus } from '@/lib/proTrustState'

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
      // The home workspace is always available — the same rule the ADMIN
      // branch above already applies to its own home role.
      //
      // This is a correction, not a widening. `resolveActingRole` (see
      // lib/currentUser.ts) grants `User.role` on BOTH of its branches without
      // ever consulting this function, so a home-PRO user is acting as PRO on
      // every request whether or not this said so, and app/pro/layout.tsx
      // admits them on exactly this rule (acting PRO + a profile exists — it
      // does NOT check APPROVED). Denying PRO here therefore withheld nothing;
      // it only hid the SWITCHER, which is the one thing that gets them back.
      //
      // Who that stranded: a client who upgraded. POST /api/v1/pro/upgrade
      // flips User.role to PRO while the licence is still PENDING, so the
      // upgraded person acted as PRO with `buildWorkspaceOptions` returning []
      // in BOTH shells — and app/client/(gated)/layout.tsx redirects any
      // acting role that is not CLIENT. Their own bookings, boards and chart
      // were unreachable until an admin approved the licence. Measured against
      // these functions, not argued.
      //
      // Entering the pro workspace from a DIFFERENT home role used to demand
      // APPROVED. It now asks the same question every other surface asks —
      // whether an admin has actively refused this pro — because a verified
      // licence became a BADGE rather than a gate (lib/proTrustState.ts). A
      // profile is still required: app/pro/layout.tsx bounces a pro who has
      // none, so offering the workspace would be a door that shuts.
      if (!user.professionalProfile) return false
      if (user.homeRole === 'PRO') return true

      return !isBarredProStatus(user.professionalProfile.verificationStatus)
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
