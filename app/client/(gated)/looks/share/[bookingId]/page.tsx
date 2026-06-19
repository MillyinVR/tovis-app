// app/client/(gated)/looks/share/[bookingId]/page.tsx
import { notFound } from 'next/navigation'

import { loadShareLookPage } from './_data/loadShareLookPage'
import ShareLookSheet from './ShareLookSheet'

export const dynamic = 'force-dynamic'

export default async function ShareLookPage({
  params,
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = await params
  const data = await loadShareLookPage(bookingId)

  if (!data) notFound()

  return (
    <main className="min-h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] bg-bgPrimary">
      <ShareLookSheet data={data} />
    </main>
  )
}
