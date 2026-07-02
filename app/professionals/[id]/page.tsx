// app/professionals/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { loadClientLinkViewer } from '@/lib/clientVisibility'
import { getCurrentUser } from '@/lib/currentUser'
import { messageStartHref } from '@/lib/messages'
import {
  buildLoginHref,
  buildProfessionalProfileHref,
  buildPublicProfileFromPath,
  buildPublicProfileTabs,
  formatPortfolioEmptyMessage,
  formatReviewsEmptyMessage,
  formatServicesEmptyMessage,
  pickPublicProfileTab,
  type PublicProfileSearchParams,
} from '@/lib/profiles/publicProfileFormatting'

import {
  loadPortfolioTiles,
  loadProPublicProfileBase,
  loadReviewsForUi,
} from './_data/loadProPublicProfile'

import AcceptedPayments from './AcceptedPayments'
import PortfolioGrid from './PortfolioGrid'
import ProfileHero from './ProfileHero'
import ProfileTabs from './ProfileTabs'
import ReviewsSummary from './ReviewsSummary'
import ServicesPanel from './ServicesPanel'

export const dynamic = 'force-dynamic'

export default async function PublicProfessionalProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PublicProfileSearchParams>
}) {
  const { id } = await params
  if (!id) notFound()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const activeTab = pickPublicProfileTab(resolvedSearchParams)

  const viewer = await getCurrentUser().catch(() => null)

  const baseResult = await loadProPublicProfileBase({
    professionalId: id,
    viewer,
  })

  if (baseResult.kind === 'not-found') notFound()
  if (baseResult.kind === 'not-viewable') {
    return <PendingVerificationSurface />
  }

  const { header, stats, offerings, acceptedPayments, isFavoritedByMe, viewerUserId } =
    baseResult.base
  const professionalId = baseResult.base.professionalId
  const isClientViewer = viewerUserId !== null

  const portfolioTiles =
    activeTab === 'portfolio' ? await loadPortfolioTiles(professionalId) : []

  const reviewsForUI =
    activeTab === 'reviews'
      ? await loadReviewsForUi({
          professionalId,
          viewerUserId,
          clientLinkViewer: await loadClientLinkViewer(viewer),
        })
      : []

  const fromPath = buildPublicProfileFromPath({
    professionalId,
    tab: activeTab,
  })

  const messageHref = viewer
    ? messageStartHref({
        kind: 'PRO_PROFILE',
        professionalId,
      })
    : buildLoginHref(fromPath)

  const servicesHref = buildProfessionalProfileHref({
    professionalId,
    tab: 'services',
  })

  const tabs = buildPublicProfileTabs(professionalId)

  return (
    <main className="brand-profile-page min-h-screen pb-28">
      <div className="brand-profile-shell">
        <ProfileHero
          header={header}
          stats={stats}
          isClientViewer={isClientViewer}
          isFavoritedByMe={isFavoritedByMe}
          messageHref={messageHref}
          servicesHref={servicesHref}
        />

        <AcceptedPayments methods={acceptedPayments} />

        <ProfileTabs tabs={tabs} activeTab={activeTab} />

        {activeTab === 'portfolio' ? (
          <PortfolioGrid
            tiles={portfolioTiles}
            emptyMessage={formatPortfolioEmptyMessage()}
          />
        ) : null}

        {activeTab === 'services' ? (
          <ServicesPanel
            professionalId={professionalId}
            offerings={offerings}
            emptyMessage={formatServicesEmptyMessage()}
          />
        ) : null}

        {activeTab === 'reviews' ? (
          <ReviewsSummary
            stats={stats}
            reviews={reviewsForUI}
            emptyMessage={formatReviewsEmptyMessage()}
          />
        ) : null}
      </div>
    </main>
  )
}

function PendingVerificationSurface() {
  return (
    <main className="brand-profile-page min-h-screen px-4 py-10">
      <div className="mx-auto max-w-180">
        <Link
          href="/looks"
          className="text-[12px] font-black text-textPrimary hover:opacity-80"
        >
          ← Back to Looks
        </Link>

        <div className="brand-profile-card mt-4 p-4">
          <div className="text-[16px] font-black text-textPrimary">
            This profile is pending verification
          </div>
          <div className="mt-2 text-[13px] text-textSecondary">
            We’re verifying the professional’s license and details. Check back
            soon.
          </div>
        </div>
      </div>
    </main>
  )
}