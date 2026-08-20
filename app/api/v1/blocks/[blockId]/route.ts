// app/api/v1/blocks/[blockId]/route.ts
//
// Lifting a person block (App Store guideline 1.2). Keyed on the UserBlock
// row's own id rather than the target's handle, because a blocked account can
// clear its handle afterwards — and a block the viewer made but cannot lift
// would be worse than the harassment it was meant to stop.
import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import type { BlockRemovedResponseDto } from '@/lib/blocks/types'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: Request,
  ctx: RouteContext<{ blockId: string }>,
) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const { blockId: rawId } = await resolveRouteParams(ctx)
    const blockId = pickString(rawId)

    if (!blockId) {
      return jsonFail(400, 'Missing block id.', { code: 'MISSING_BLOCK_ID' })
    }

    // 🔴 Scoped to the viewer's OWN blocks. `deleteMany` with blockerUserId in
    // the WHERE is what makes that a database-enforced fact rather than a
    // check-then-act: a `delete` by id alone would let any signed-in user lift
    // anyone else's block by guessing an id.
    await prisma.userBlock.deleteMany({
      where: { id: blockId, blockerUserId: auth.user.id },
    })

    // Idempotent, and deliberately does not distinguish "not yours" from
    // "already gone": both mean the viewer is not blocking that person, and
    // telling them apart would confirm that some other user's block row exists.
    const body: BlockRemovedResponseDto = { blockId, blocked: false }
    return jsonOk(body, 200)
  } catch (error) {
    console.error('DELETE /api/v1/blocks/[blockId] error', {
      error: safeError(error),
    })
    return jsonFail(500, 'Couldn’t unblock this account. Try again.', {
      code: 'INTERNAL',
    })
  }
}
