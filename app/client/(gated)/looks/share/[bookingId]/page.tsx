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

  // ShareLookSheet mounts <ClientPage> itself — the sheet is a client component
  // and its header is part of that component's own state-driven layout.
  return <ShareLookSheet data={data} />

}
