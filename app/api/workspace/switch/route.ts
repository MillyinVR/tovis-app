// app/api/workspace/switch/route.ts
//
// Switch the active workspace (CLIENT / PRO / ADMIN) for the current session.
//
// The DB `User.role` is never mutated — it stays the user's permanent home
// role. Instead we re-mint the session JWT carrying the *acting* role, after
// verifying the user is genuinely entitled to it (canActAs over stable DB
// data). getCurrentUser re-checks that entitlement on every request, so this
// can only ever grant a workspace the user already owns.

import { Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { createActiveToken } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import { canActAs, WORKSPACE_HOME } from '@/lib/auth/workspaces'
import { prisma } from '@/lib/prisma'
import { isUniqueConstraintError } from '@/lib/prismaErrors'
import { buildClientProfileContactLookupData } from '@/lib/security/contactLookup'
import { buildPhoneEncryptionWriteData } from '@/lib/security/phonePrivacy'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'

const VALID_WORKSPACES: readonly Role[] = [Role.CLIENT, Role.PRO, Role.ADMIN]

/** Read & validate the `workspace` field off an unknown JSON body, cast-free. */
function parseWorkspace(body: unknown): Role | null {
  if (typeof body !== 'object' || body === null || !('workspace' in body)) {
    return null
  }
  const value = body.workspace
  return VALID_WORKSPACES.find((role) => role === value) ?? null
}

/**
 * Provision a ClientProfile for a user who is entering the Client workspace
 * without one (e.g. an admin/pro browsing as a client). Mirrors the signup
 * create path (tenant, contact-lookup hashes, phone encryption). Idempotent:
 * no-ops if one already exists, and tolerates a concurrent create.
 */
async function ensureClientProfile(
  request: Request,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
): Promise<void> {
  const existing = await prisma.clientProfile.findFirst({
    where: { userId: user.id },
    select: { id: true },
  })
  if (existing) return

  const tenant = await resolveTenantContextForRequest(request)
  const phone = user.phone ?? undefined // pii-plaintext-read-ok: fed into lib/security phone hash/encrypt helpers; not stored or logged

  try {
    await prisma.clientProfile.create({
      data: {
        user: { connect: { id: user.id } },
        homeTenant: { connect: { id: tenant.tenantId } },
        phone,
        claimStatus: 'CLAIMED',
        claimedAt: new Date(),
        // email read feeds the lib/security contact-hash helper on the next line; not stored or logged
        ...buildClientProfileContactLookupData({ email: user.email, phone }), // pii-plaintext-read-ok: contact-hash helper input
        ...buildPhoneEncryptionWriteData({ phone }),
      },
    })
  } catch (error) {
    // A concurrent switch may have created it first; the unique userId
    // constraint makes that safe to ignore.
    if (!isUniqueConstraintError(error)) throw error
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return jsonFail(401, 'Not authenticated')

  // Switching is only meaningful from a fully-active session.
  if (user.sessionKind !== 'ACTIVE' || !user.isFullyVerified) {
    return jsonFail(403, 'Session is not active')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonFail(400, 'Invalid request body')
  }

  const target = parseWorkspace(body)
  if (!target) return jsonFail(400, 'Unknown workspace')

  const entitled = canActAs(
    {
      homeRole: user.homeRole,
      clientProfile: user.clientProfile,
      professionalProfile: user.professionalProfile,
    },
    target,
  )
  if (!entitled) return jsonFail(403, 'Workspace not available')

  if (target === Role.CLIENT && !user.clientProfile) {
    await ensureClientProfile(request, user)
  }

  // Re-mint the session with the acting role; preserve authVersion so existing
  // revocation flows still apply. User.role in the DB is left untouched.
  const token = createActiveToken({
    userId: user.id,
    role: target,
    authVersion: user.authVersion,
  })

  // Native replays `token` as a bearer; web uses the cookie. The re-minted
  // token carries the new acting role, so native must swap to this one.
  const response = jsonOk({
    workspace: target,
    href: WORKSPACE_HOME[target],
    token,
  })
  setSessionCookie({ response, request, token })
  return response
}
