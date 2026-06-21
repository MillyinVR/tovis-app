import { Suspense } from 'react'
import BrandLoader from '@/lib/brand/BrandLoader'
import ReferralListClient from './ReferralListClient'

export const dynamic = 'force-dynamic'

export default function ClientReferralsPage() {
  return (
    <Suspense fallback={<BrandLoader variant="inline" />}>
      <ReferralListClient />
    </Suspense>
  )
}
