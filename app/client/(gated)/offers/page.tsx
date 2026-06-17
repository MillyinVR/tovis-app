import { Suspense } from 'react'

import OffersListClient from './OffersListClient'

export const dynamic = 'force-dynamic'

export default function ClientPriorityOffersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-textMuted">
          Loading your offers…
        </div>
      }
    >
      <OffersListClient />
    </Suspense>
  )
}
