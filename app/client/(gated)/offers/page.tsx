import { Suspense } from 'react'

import BrandLoader from '@/lib/brand/BrandLoader'
import OffersListClient from './OffersListClient'
import WaitlistOfferCards from './WaitlistOfferCards'

export const dynamic = 'force-dynamic'

export default function ClientPriorityOffersPage() {
  return (
    <div className="space-y-6">
      <WaitlistOfferCards />
      <Suspense fallback={<BrandLoader variant="inline" />}>
        <OffersListClient />
      </Suspense>
    </div>
  )
}
