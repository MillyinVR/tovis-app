// app/professionals/[id]/_components/PublicProfileView.tsx
//
// Shared render for a pro's public profile, keyed by ProfessionalProfile id.
// Two routes render this: `/professionals/[id]` (id-keyed, canonical) and
// `/p/[handle]` (handle-keyed vanity mirror — also what `<handle>.tovis.me`
// rewrites to, and what NFC-card taps hand out for premium pros). Keeping the
// render in one place means the vanity link lands on the full profile instead
// of a stripped link-in-bio card.
//
// Screen 6 redesign — "a profile you scroll, not a listing you scan":
//   - The header is a brand BAND, never a photograph. No cover behind the
//     avatar on any profile; that dissolves the no-cover state rather than
//     solving it, and keeps the first picture on the page the Signature post.
//     `header.coverUrl` still feeds share cards and search — just not here.
//   - Portfolio / Services / Reviews now switch IN PLACE. All three arrive in
//     ONE payload (what iOS has always done) instead of a `?tab=` round-trip.
//   - Booking lives in exactly two quiet places: an outline action on the
//     Signature post, and a slim bar between the end of the scroll and the
//     footer. Nothing floats and nothing follows the scroll.
import Link from 'next/link'
import { notFound } from 'next/navigation'

import JsonLdScript from '@/app/_components/seo/JsonLdScript'
import BrandWordmark from '@/lib/brand/BrandWordmark'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadClientLinkViewer } from '@/lib/clientVisibility'
import {
  loadViewerBlockId,
  resolveBlockTargetByProfessionalId,
} from '@/lib/blocks/blockTargets'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import { messageStartHref } from '@/lib/messages'
import { loadProProfileSeoById } from '@/lib/profiles/proProfileSeo'
import { absoluteUrl } from '@/lib/seo/absoluteUrl'
import { buildProProfileJsonLd } from '@/lib/seo/proProfileJsonLd'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { VerificationStatus } from '@prisma/client'
import {
  buildLoginHref,
  buildPublicProfileBookBar,
  buildPublicProfileFromPath,
  buildPublicProfileTabLabels,
  formatPortfolioEmptyMessage,
  formatReviewsEmptyMessage,
  formatServicesEmptyMessage,
  pickPublicProfileTab,
  type PublicProfileSearchParams,
} from '@/lib/profiles/publicProfileFormatting'

import {
  loadProProfileWork,
  loadProPublicProfileBase,
  loadReviewsForUi,
} from '../_data/loadProPublicProfile'

import ReviewsSummary from '../ReviewsSummary'
import ServicesPanel from '../ServicesPanel'

import PortfolioFeed from './PortfolioFeed'
import ProfileBody from './ProfileBody'
import ProfileIdentityRail from './ProfileIdentityRail'
import SignatureCard from './SignatureCard'

export default async function PublicProfileView({
  id,
  searchParams,
}: {
  id: string
  searchParams?: PublicProfileSearchParams
}) {
  const activeTab = pickPublicProfileTab(searchParams)

  const viewer = await getCurrentUser().catch(() => null)

  // One tenant resolution for the whole render — React-cached, and it fails soft
  // to root branding rather than 500-ing the page.
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  const baseResult = await loadProPublicProfileBase({
    professionalId: id,
    viewer,
    brandName: brand.displayName,
  })

  if (baseResult.kind === 'not-found') notFound()
  if (baseResult.kind === 'not-viewable') {
    return <PendingVerificationSurface />
  }

  const {
    header,
    stats,
    offerings,
    acceptedPayments,
    isFavoritedByMe,
    viewerUserId,
    signals,
  } = baseResult.base
  const professionalId = baseResult.base.professionalId
  const isClientViewer = viewerUserId !== null

  // ONE payload: every tab's content loads up front and the tabs switch in
  // place. The reviews read still depends on the viewer (their own "helpful"
  // marks), so it can't be hoisted out of the request.
  const [work, reviewsForUI] = await Promise.all([
    loadProProfileWork({
      professionalId,
      signatureMediaAssetId: baseResult.base.signatureMediaAssetId,
      offerings: baseResult.base.offeringRows,
    }),
    loadReviewsForUi({
      professionalId,
      viewerUserId,
      clientLinkViewer: await loadClientLinkViewer(viewer),
    }),
  ])

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

  // The pro's own view of a still-pending profile: the page renders in full (it
  // is worth reading) but the bar goes inert rather than offering a booking the
  // server would refuse.
  const isPendingVerification =
    baseResult.base.verificationStatus !== VerificationStatus.APPROVED

  const cheapestOffering = offerings.reduce<(typeof offerings)[number] | null>(
    (best, offering) => {
      if (offering.priceFromNumber === null) return best
      if (!best || best.priceFromNumber === null) return offering
      return offering.priceFromNumber < best.priceFromNumber ? offering : best
    },
    null,
  )

  // Guideline 1.2: can this viewer block this pro, and do they already?
  // Hidden for a guest (no one to block for) and for the pro's own profile.
  const blockTarget = viewer
    ? await resolveBlockTargetByProfessionalId(prisma, professionalId)
    : null
  const blockState =
    viewer && blockTarget && blockTarget.userId !== viewer.id
      ? {
          blockId: await loadViewerBlockId(prisma, {
            viewerUserId: viewer.id,
            blockedUserId: blockTarget.userId,
          }),
        }
      : null

  const bookBar = buildPublicProfileBookBar({
    isPendingVerification,
    isSignedIn: Boolean(viewer),
    availabilityLine: signals.availabilityLine,
    priceFromLabel: stats.priceFromLabel,
    cheapestServiceName: cheapestOffering?.name ?? null,
    serviceCount: offerings.length,
  })

  const tabLabels = buildPublicProfileTabLabels({
    // The Signature post left the grid, so it has to be counted back in — the
    // tab label reports the pro's work, not the grid's row count.
    portfolio: work.portfolioTiles.length + (work.signature ? 1 : 0),
    services: offerings.length,
    reviews: reviewsForUI.length,
  })

  // Crawler-facing structured data; cache() dedupes with generateMetadata.
  // Fail-soft: SEO decoration must never break the page render.
  let jsonLd: Record<string, unknown> | null = null
  try {
    const seo = await loadProProfileSeoById(professionalId)
    if (seo) {
      jsonLd = buildProProfileJsonLd({
        seo,
        canonicalUrl: absoluteUrl(`/professionals/${professionalId}`),
        brandDisplayName: brand.displayName,
      })
    }
  } catch {
    jsonLd = null
  }

  return (
    <main className="brand-pp-page min-h-screen">
      {jsonLd ? <JsonLdScript data={jsonLd} /> : null}

      <div className="brand-pp-shell">
        {/* The header band. No photograph sits behind the avatar on any
            profile — the band carries the brand mark and the handle in mono. */}
        <section className="brand-pp-band">
          <div className="brand-pp-band-actions">
            <Link
              href="/looks"
              className="brand-button-ghost brand-focus tap-target grid h-9 w-9 place-items-center text-[18px] font-black"
              aria-label="Back to Looks"
              title="Back to Looks"
            >
              ←
            </Link>
          </div>

          <div className="grid justify-items-center gap-2.5 opacity-90">
            <BrandWordmark size={22} />
            {header.displayHandle ? (
              <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-textMuted">
                {header.displayHandle}
              </div>
            ) : null}
          </div>
        </section>

        <ProfileBody
          initialTab={activeTab}
          labels={tabLabels}
          identityRail={
            <ProfileIdentityRail
              header={header}
              followerCount={stats.followerCount}
              isClientViewer={isClientViewer}
              canFollow={isClientViewer || !viewer}
              isFavoritedByMe={isFavoritedByMe}
              isPendingVerification={isPendingVerification}
              messageHref={messageHref}
              fromPath={fromPath}
              acceptedPayments={acceptedPayments}
              signals={signals}
              block={blockState}
            />
          }
          portfolio={
            <>
              {work.signature ? (
                <SignatureCard signature={work.signature} />
              ) : null}

              <PortfolioFeed
                tiles={work.portfolioTiles}
                emptyMessage={formatPortfolioEmptyMessage()}
              />
            </>
          }
          services={
            <ServicesPanel
              professionalId={professionalId}
              offerings={offerings}
              emptyMessage={formatServicesEmptyMessage()}
            />
          }
          reviews={
            <ReviewsSummary
              professionalId={professionalId}
              stats={stats}
              reviews={reviewsForUI}
              emptyMessage={formatReviewsEmptyMessage()}
            />
          }
          bookBar={bookBar}
        />
      </div>
    </main>
  )
}

function PendingVerificationSurface() {
  return (
    <main className="brand-pp-page min-h-screen px-4 py-10">
      <div className="mx-auto max-w-180">
        <Link
          href="/looks"
          className="text-[12px] font-black text-textPrimary hover:opacity-80"
        >
          ← Back to Looks
        </Link>

        <div className="brand-pp-card mt-4 p-4">
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
