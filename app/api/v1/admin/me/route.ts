// GET /api/v1/admin/me — who this admin is, and which admin surfaces their
// permissions unlock.
//
// The web admin reads this through `getAdminUiPerms()` inside a server
// component; a native client has no such door, so without this route iOS would
// have to guess at the tab list and discover each denial as a 403 on open.
// ADMIN role only — the permission MAP is the payload, so there is no
// per-surface gate here beyond being an admin at all.
import { Role } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { getAdminUiPermsForUser } from '@/lib/adminUiPermissions'
import type { AdminMeDTO } from '@/lib/dto/adminModeration'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Deliberately `requireUser` rather than `getAdminUiPerms()`: that helper
    // collapses "signed out" and "not an admin" into one null, and a native
    // client must tell those apart — 401 re-authenticates, 403 must not.
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res

    const admin: AdminMeDTO = {
      userId: auth.user.id,
      email: auth.user.email,
      perms: await getAdminUiPermsForUser(auth.user.id),
    }

    return jsonOk({ ok: true, admin })
  } catch (error) {
    console.error('GET /api/v1/admin/me error', error)
    return jsonFail(500, 'Internal server error')
  }
}
