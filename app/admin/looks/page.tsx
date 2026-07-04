// app/admin/looks/page.tsx — Looks/UGC moderation queue across tenants
// (social-first AM1, App Store gate before iOS submission). Approve/reject/hide
// looks + comments, dismiss reports, and Feature a look into Spotlight.
// SUPER_ADMIN only (the API enforces it; the page gates on Role.ADMIN like the
// rest of /admin). Client-authored looks appear here by design (prerequisite
// for unlocking client looks into the public feed, social-first C2).
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import LooksAdminClient from './LooksAdminClient'

export const dynamic = 'force-dynamic'

export default async function AdminLooksPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5">
        <h1 className="text-[22px] font-black">Looks moderation</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Reported, pending, and flagged looks &amp; comments across all pros —
          client-authored looks included. Rejecting or removing a look drops it
          out of the public feed; dismissing a report keeps it live. You can also
          feature a standout look into the Spotlight feed.
        </p>
      </div>
      <LooksAdminClient />
    </main>
  )
}
