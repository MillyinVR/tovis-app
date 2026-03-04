// app/api/admin/verification-docs/open/route.ts
import { prisma } from '@/lib/prisma'
import { jsonFail } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { AdminPermissionRole, Role } from '@prisma/client'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function trimId(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function parseSupabaseRef(input: string): { bucket: string; path: string } | null {
  const s = input.trim()
  if (!s.startsWith('supabase://')) return null
  const rest = s.slice('supabase://'.length)
  const idx = rest.indexOf('/')
  if (idx <= 0) return null
  const bucket = rest.slice(0, idx).trim()
  const path = rest.slice(idx + 1).trim()
  if (!bucket || !path) return null
  return { bucket, path }
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
      allowedRoles: [AdminPermissionRole.SUPER_ADMIN, AdminPermissionRole.REVIEWER, AdminPermissionRole.SUPPORT],
      scope: { professionalId: doc.professionalId },
    })
    if (!perm.ok) return perm.res

    const href = (doc.url ?? doc.imageUrl ?? '').trim()
    if (!href) return jsonFail(404, 'Document has no URL.')

    const ref = parseSupabaseRef(href)
    if (ref) {
      const admin = getSupabaseAdmin()
      const { data, error } = await admin.storage.from(ref.bucket).createSignedUrl(ref.path, 60 * 10) // 10 min
      if (error) return jsonFail(500, error.message || 'Failed to sign URL.')
      const signedUrl = (data as { signedUrl?: string } | null)?.signedUrl ?? null
      if (!signedUrl) return jsonFail(500, 'Signed URL missing.')
      return Response.redirect(signedUrl, 302)
    }

    // Allow only http(s) redirects for non-supabase URLs (avoid weird open redirects)
    if (href.startsWith('https://') || href.startsWith('http://')) {
      return Response.redirect(href, 302)
    }

    return jsonFail(400, 'Unsupported document URL format.')
  } catch (e) {
    console.error('GET /api/admin/verification-docs/open error', e)
    return jsonFail(500, 'Internal server error')
  }
}