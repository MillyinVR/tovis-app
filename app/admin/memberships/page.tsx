// app/admin/memberships/page.tsx — search pros, see membership state, grant or
// revoke complimentary months. SUPER_ADMIN only (the API enforces it; the page
// gates on Role.ADMIN like the rest of /admin).
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import MembershipsAdminClient from './MembershipsAdminClient'

export const dynamic = 'force-dynamic'

export default async function AdminMembershipsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5">
        <h1 className="text-[22px] font-black">Memberships</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Look up a pro, see their plan, and grant or revoke complimentary
          months. Comps stack on top of paid subscriptions and expire on their
          own.
        </p>
      </div>
      <MembershipsAdminClient />
    </main>
  )
}
