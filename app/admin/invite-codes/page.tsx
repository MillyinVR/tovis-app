import { AdminPermissionRole } from '@prisma/client'

import AdminGuard from '../_components/AdminGuard'
import InviteCodesAdminClient from './InviteCodesAdminClient'

export const dynamic = 'force-dynamic'

export default function AdminInviteCodesPage() {
  return (
    <AdminGuard
      allowedRoles={[AdminPermissionRole.SUPER_ADMIN]}
      from="/admin/invite-codes"
    >
      <InviteCodesAdminClient />
    </AdminGuard>
  )
}
