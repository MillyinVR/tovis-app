import { redirect } from 'next/navigation'

import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { getCurrentUser } from '@/lib/currentUser'

import ClientPage from '../../_components/ClientPage'
import ClientConsultFlow from './ClientConsultFlow'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }> | { id: string }
}

export default async function ClientConsultFlowPage({ params }: PageProps) {
  const { id } = await Promise.resolve(params)
  const from = `/client/consult/${encodeURIComponent(id)}`
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(`/login?from=${encodeURIComponent(from)}`)
  }

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const copy = brand.clientConsultResults

  return (
    <ClientPage
      eyebrow={copy.eyebrow}
      title="A full look at what suits you"
      lede="Answer a few questions and add daylight photos. You get feature-grounded directions to discuss with your professional at your appointment."
      back={{ href: '/client/bookings', label: 'Bookings' }}
      width="wide"
    >
      <ClientConsultFlow consultId={id} />
    </ClientPage>
  )
}
