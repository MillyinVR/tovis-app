// app/admin/_components/AdminGuard.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { AdminPermissionRole } from '@prisma/client'

type Scope = {
  professionalId?: string | null
  serviceId?: string | null
  categoryId?: string | null
}

function loginHref(from: string, reason: 'LOGIN_REQUIRED' | 'ADMIN_REQUIRED') {
  return `/login?from=${encodeURIComponent(from)}&reason=${encodeURIComponent(reason)}`
}

export default async function AdminGuard({
  children,
  allowedRoles,
  scope,
  from,
}: {
  children: React.ReactNode
  allowedRoles?: AdminPermissionRole[]
  scope?: Scope
  from?: string
}) {
  const fromPath = from ?? '/admin'

  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect(loginHref(fromPath, 'LOGIN_REQUIRED'))

  if (user.role !== 'ADMIN') {
    redirect(loginHref(fromPath, 'ADMIN_REQUIRED'))
  }

  if (allowedRoles?.length) {
    const ok = await hasAdminPermission({
      adminUserId: user.id,
      allowedRoles,
      scope,
    })
    if (!ok) redirect('/admin')
  }

  return <>{children}</>
}