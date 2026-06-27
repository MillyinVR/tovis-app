// app/api/v1/pro/verification-docs/[id]/route.ts
//
// Lets a pro remove one of their own verification documents while it is
// still pending review (e.g. a blurry photo they want to replace).
// Reviewed documents (approved/rejected/needs-info) are the admin audit
// trail and cannot be deleted by the pro.

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { VerificationStatus } from '@prisma/client'
import { jsonFail, jsonOk, requirePro } from '@/app/api/_utils'
import { resolveRouteParams, type RouteContext } from '@/app/api/_utils/routeContext'
import { pickString } from '@/lib/pick'
import { safeError } from '@/lib/security/logging'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { parseSupabasePointer, safeUrl } from '@/lib/media'

export const dynamic = 'force-dynamic'

// View one of the pro's OWN verification documents — 302-redirects to a
// short-lived signed URL for the private media bucket. Lets the pro preview the
// license photo they uploaded (mirrors the admin open route, scoped to self).
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
    const docId = pickString(rawId)
    if (!docId) return jsonFail(400, 'Missing id.')

    const doc = await prisma.verificationDocument.findUnique({
      where: { id: docId },
      select: { id: true, professionalId: true, url: true, imageUrl: true },
    })

    if (!doc) return jsonFail(404, 'Not found.')
    if (doc.professionalId !== auth.professionalId) return jsonFail(403, 'Forbidden.')

    const hrefRaw = (doc.url ?? doc.imageUrl ?? '').trim()
    const ptr = hrefRaw ? parseSupabasePointer(hrefRaw) : null
    if (!ptr || ptr.bucket !== 'media-private') {
      return jsonFail(400, 'Unsupported document URL.')
    }

    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(ptr.bucket)
      .createSignedUrl(ptr.path, 60 * 10)

    if (error) return jsonFail(500, 'Failed to sign URL.')

    const signed = safeUrl((data as { signedUrl?: unknown } | null)?.signedUrl)
    if (!signed) return jsonFail(500, 'Signed URL missing.')

    return NextResponse.redirect(signed, 302)
  } catch (e: unknown) {
    console.error('GET /api/v1/pro/verification-docs/[id] error', { error: safeError(e) })
    return jsonFail(500, 'Failed to open document.')
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res

    const { id: rawId } = await resolveRouteParams(ctx)
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
    console.error('DELETE /api/v1/pro/verification-docs/[id] error', {
      error: safeError(e),
    })

    return jsonFail(500, 'Failed to delete document.')
  }
}
