import { Suspense } from 'react'

import BrandLoader from '@/lib/brand/BrandLoader'
import ClientPage from '../_components/ClientPage'
import OffersListClient from './OffersListClient'
import WaitlistOfferCards from './WaitlistOfferCards'

export const dynamic = 'force-dynamic'

export default function ClientPriorityOffersPage() {
  return (
    <ClientPage
      eyebrow="Priority offers"
      title="You’re first in line"
      lede="Claim before the timer runs out, or pass to give it to the next person."
      back={{ href: '/client', label: 'Home' }}
    >
      <div className="space-y-6">
        <WaitlistOfferCards />
        <Suspense fallback={<BrandLoader variant="inline" />}>
          <OffersListClient />
        </Suspense>
      </div>
    </ClientPage>
  )
}
