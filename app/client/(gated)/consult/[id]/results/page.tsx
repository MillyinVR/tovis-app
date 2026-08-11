import { notFound, redirect } from 'next/navigation'

import { getBrandConfig } from '@/lib/brand'
import {
  ClientConsultResultsError,
  loadAuthorizedClientConsultResults,
} from '@/lib/consult/clientResults'
import { getCurrentUser } from '@/lib/currentUser'

import ClientConsultResults from './ClientConsultResults'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }> | { id: string }
}

export default async function ClientConsultResultsPage({ params }: PageProps) {
  const { id } = await Promise.resolve(params)
  const from = `/client/consult/${encodeURIComponent(id)}/results`
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(from)}`)
  }

  let results
  try {
    results = await loadAuthorizedClientConsultResults({
      consultSessionId: id,
      clientId: user.clientProfile.id,
      actorUserId: user.id,
    })
  } catch (error: unknown) {
    if (error instanceof ClientConsultResultsError) notFound()
    throw error
  }

  return (
    <ClientConsultResults
      results={results}
      copy={getBrandConfig().clientConsultResults}
    />
  )
}
