import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { revokeSignupInvite } from '@/lib/admin/signupInvites'
import { requireSignupInviteAdmin } from '../_auth'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<Response> {
  const auth = await requireSignupInviteAdmin()
  if (!auth.ok) return auth.res

  const { id } = await resolveRouteParams(context)
  const result = await revokeSignupInvite({
    adminUserId: auth.user.id,
    inviteId: id,
  })

  if (result === 'not_found') return jsonFail(404, 'Invite code not found.')
  if (result === 'used') {
    return jsonFail(409, 'Used invite codes cannot be revoked.')
  }

  return jsonOk({ status: result }, 200)
}
