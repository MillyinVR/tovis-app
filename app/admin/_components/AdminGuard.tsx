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
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect(`/login?from=${encodeURIComponent(from ?? '/admin')}`)
  if (user.role !== 'ADMIN') redirect('/')

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
