import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { resolveFounderPortalAccess } from '@/lib/founders/access'
import { founderPortalDTO } from '@/lib/founders/portal'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const access = await resolveFounderPortalAccess(auth.user)
    if (!access.canAccess) return jsonFail(403, 'Founders Portal access required.')

    return jsonOk({ portal: await founderPortalDTO(auth.user.id, access) })
  } catch (error: unknown) {
    console.error('GET /api/v1/founders/portal', error)
    return jsonFail(500, 'Could not load the Founders Portal.')
  }
}
