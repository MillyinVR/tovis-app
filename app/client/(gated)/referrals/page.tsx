import { Suspense } from 'react'
import BrandLoader from '@/lib/brand/BrandLoader'
import InviteLinkCard from './_components/InviteLinkCard'
import ReferralListClient from './ReferralListClient'

export const dynamic = 'force-dynamic'

export default function ClientReferralsPage() {
  return (
    <div className="mx-auto grid max-w-180 gap-4 px-4 pt-4">
      <Suspense fallback={null}>
        <InviteLinkCard />
      </Suspense>

      <Suspense fallback={<BrandLoader variant="inline" />}>
        <ReferralListClient />
      </Suspense>
    </div>
  )
}
