// app/api/admin/verification-docs/open/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { jsonFail } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { AdminPermissionRole, Role } from '@prisma/client'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { parseSupabasePointer, safeUrl } from '@/lib/media'

export const dynamic = 'force-dynamic'

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function getSafeErrorLog(error: unknown): {
  errorName: string
  errorMessage: string
} {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message || 'Verification document open error.',
    }
  }

  return {
    errorName: 'UnknownError',
    errorMessage: 'Unknown verification document open error.',
  }
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const url = new URL(req.url)
    const id = trimId(url.searchParams.get('id'))
    if (!id) return jsonFail(400, 'Missing id.')

    const doc = await prisma.verificationDocument.findUnique({
      where: { id },
      select: {
        id: true,
        professionalId: true,
        url: true,
        imageUrl: true,
      },
    })

    if (!doc) return jsonFail(404, 'Document not found.')

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
        AdminPermissionRole.SUPPORT,
      ],
      scope: { professionalId: doc.professionalId },
    })

    if (!perm.ok) return perm.res

    const hrefRaw = (doc.url ?? doc.imageUrl ?? '').trim()
    if (!hrefRaw) return jsonFail(404, 'Document has no URL.')

    const ptr = parseSupabasePointer(hrefRaw)

    const SIGNED_URL_TTL_SECONDS = 60 * 10
    const PRIVATE_MEDIA_BUCKET = 'media-private'

    if (!ptr) {
      return jsonFail(400, 'Unsupported document URL format.')
    }

    if (ptr.bucket !== PRIVATE_MEDIA_BUCKET) {
      return jsonFail(400, 'Invalid document bucket.')
    }

    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(ptr.bucket)
      .createSignedUrl(ptr.path, SIGNED_URL_TTL_SECONDS)

    if (error) {
      console.error('GET /api/admin/verification-docs/open sign error', {
        errorName: error.name ?? 'StorageError',
        errorMessage: error.message || 'Failed to sign URL.',
      })

      return jsonFail(500, 'Failed to sign URL.')
    }

    const signed = safeUrl((data as { signedUrl?: unknown } | null)?.signedUrl)

    if (!signed) {
      return jsonFail(500, 'Signed URL missing.')
    }

    return NextResponse.redirect(signed, 302)
  } catch (error: unknown) {
    console.error(
      'GET /api/admin/verification-docs/open error',
      getSafeErrorLog(error),
    )

    return jsonFail(500, 'Internal server error')
  }
}