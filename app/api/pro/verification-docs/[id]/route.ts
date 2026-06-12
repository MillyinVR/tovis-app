// app/api/pro/verification-docs/[id]/route.ts
//
// Lets a pro remove one of their own verification documents while it is
// still pending review (e.g. a blurry photo they want to replace).
// Reviewed documents (approved/rejected/needs-info) are the admin audit
// trail and cannot be deleted by the pro.

import { prisma } from '@/lib/prisma'
import { VerificationStatus } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { pickString } from '@/lib/pick'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await ctx.params
    const docId = pickString(rawId)
    if (!docId) return jsonFail(400, 'Missing id.')

    const existing = await prisma.verificationDocument.findUnique({
      where: { id: docId },
      select: { id: true, professionalId: true, status: true },
    })

    if (!existing) return jsonFail(404, 'Not found.')
    if (existing.professionalId !== auth.professionalId) return jsonFail(403, 'Forbidden.')
    if (existing.status !== VerificationStatus.PENDING) {
      return jsonFail(409, 'Only pending documents can be removed.')
    }

    await prisma.verificationDocument.delete({ where: { id: docId } })
    return jsonOk({}, 200)
  } catch (e: unknown) {
    console.error('DELETE /api/pro/verification-docs/[id] error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Failed to delete document.')
  }
}
