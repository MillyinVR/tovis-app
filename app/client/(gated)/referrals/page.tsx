import { Suspense } from 'react'
import ReferralListClient from './ReferralListClient'

export const dynamic = 'force-dynamic'

export default function ClientReferralsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-textMuted">
          Loading referrals…
        </div>
      }
    >
      <ReferralListClient />
    </Suspense>
  )
}
