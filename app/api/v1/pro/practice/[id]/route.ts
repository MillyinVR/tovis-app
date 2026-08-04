// app/api/v1/pro/practice/[id]/route.ts
//
// DELETE one practice shot.
//
// Hard delete, owner-only — the pro library editor's Delete works the same way
// (DELETE /api/v1/pro/media/[id]). The stored object is removed too: a practice
// shot's bytes are referenced by exactly one row (the (bucket, path) unique
// index guarantees it), and ATTACHING copies the bytes rather than sharing them,
// so deleting a shot can never pull the object out from under a MediaAsset that
// was promoted from it.

import { NextRequest } from 'next/server'

import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { prisma } from '@/lib/prisma'
import {
  isProPracticeDisabled,
  loadOwnedPracticeShot,
  PRACTICE_DISABLED_MESSAGE,
} from '@/lib/proPractice'
import { safeError } from '@/lib/security/logging'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    if (await isProPracticeDisabled()) {
      return jsonFail(503, PRACTICE_DISABLED_MESSAGE, {
        code: 'PRO_PRACTICE_DISABLED',
      })
    }

    const { id: rawId } = await resolveRouteParams(ctx)
    const shotId = pickString(rawId)
    if (!shotId) return jsonFail(400, 'Missing practice shot id.')

    const owned = await loadOwnedPracticeShot(shotId, auth.professionalId)
    if (!owned.ok) return jsonFail(owned.status, owned.error)

    await prisma.practiceShot.delete({ where: { id: owned.shot.id } })

    // Row first, bytes second: a failed object delete leaves an orphaned object
    // (a storage sweep's problem) rather than a row pointing at nothing, and it
    // must not fail the request the pro just made.
    try {
      await getSupabaseAdmin()
        .storage.from(owned.shot.storageBucket)
        .remove([owned.shot.storagePath])
    } catch (storageError) {
      console.error('DELETE /api/v1/pro/practice/[id] storage remove failed', {
        error: safeError(storageError),
      })
    }

    return jsonOk({ deleted: true }, 200)
  } catch (e) {
    console.error('DELETE /api/v1/pro/practice/[id] error', { error: safeError(e) })
    return jsonFail(500, 'Internal server error')
  }
}
