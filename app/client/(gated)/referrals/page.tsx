import { Suspense } from 'react'
import BrandLoader from '@/lib/brand/BrandLoader'
import ClientPage from '../_components/ClientPage'
import InviteLinkCard from './_components/InviteLinkCard'
import ReferralListClient from './ReferralListClient'

export const dynamic = 'force-dynamic'

export default function ClientReferralsPage() {
  return (
    <ClientPage
      eyebrow="Referrals"
      title="Invite a friend"
      lede="Share your link. When a friend joins and books, the referral is credited to you."
      back={{ href: '/client', label: 'Home' }}
    >
      <div className="grid gap-5">
        <Suspense fallback={null}>
          <InviteLinkCard />
        </Suspense>

        <Suspense fallback={<BrandLoader variant="inline" />}>
          <ReferralListClient />
        </Suspense>
      </div>
    </ClientPage>
  )
}
