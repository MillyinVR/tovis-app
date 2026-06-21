import { Suspense } from 'react'

import BrandLoader from '@/lib/brand/BrandLoader'
import OffersListClient from './OffersListClient'

export const dynamic = 'force-dynamic'

export default function ClientPriorityOffersPage() {
  return (
    <Suspense fallback={<BrandLoader variant="inline" />}>
      <OffersListClient />
    </Suspense>
  )
}
