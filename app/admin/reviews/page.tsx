// app/admin/reviews/page.tsx — recent reviews across tenants with moderation
// actions: hide/unhide a review, remove an abusive pro reply. SUPER_ADMIN only
// (the API enforces it; the page gates on Role.ADMIN like the rest of /admin).
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import ReviewsAdminClient from './ReviewsAdminClient'

export const dynamic = 'force-dynamic'

export default async function AdminReviewsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5">
        <h1 className="text-[22px] font-black">Review moderation</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Recent reviews across all pros. Hiding a review keeps it on file but
          removes it from public profiles and rating averages; you can also
          remove an abusive pro reply without touching the review itself.
        </p>
      </div>
      <ReviewsAdminClient />
    </main>
  )
}
