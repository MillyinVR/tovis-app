// app/client/(gated)/viral/[id]/page.tsx
//
// One approved viral look, and the pros who explicitly opted into it.
//
// ── Why this page exists ───────────────────────────────────────────────────
//
// The client home has always ended the viral loop in a text search:
// `/search?q={look name}`. That returned whatever the words happened to match —
// pros who had never heard of the look — while the card above it claimed "N
// pros now offer this" from a count of notification DELIVERY rows. Two halves
// of the same untruth. Tori, 2026-09-15: tapping a look leads to the
// professionals who explicitly opted in, with a path toward booking.
//
// ── Route placement is deliberate ──────────────────────────────────────────
//
// ⚠️ NOT `/looks/…`. That prefix is an associated Universal Link, so on a
// device with the app installed iOS would swallow the tap and hand the path to
// a native parser that reads the second segment as a LookPost id — the app
// would open onto nothing. See `viralLookPath` in lib/routes.ts.
//
// ⚠️ The gated layout's redirect is NOT the whole gate. A layout and its page
// render in PARALLEL, so an anonymous request still ran this page's loader and
// shipped the look — its name AND the pros who opted into it — inside the RSC
// payload of a 200. Observed with curl, not reasoned about. `requireClientPage`
// is what stops the work happening at all.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { buttonClassName } from '@/app/_components/ui'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { viralOfferingLede } from '@/lib/brand/viralLooksCopy'
import { viralLookPath } from '@/lib/routes'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { loadLiveViralLookForClient } from '@/lib/viralRequests/liveLooks'

import ClientPage from '../../_components/ClientPage'
import { gradientAvatar, platformFromUrl } from '../../_components/homeVisuals'
import { requireClientPage } from '../../_data/requireClientPage'
import ViralLookPros from './ViralLookPros'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  // A viral look is a marketplace object, but this page sits behind the client
  // gate — there is nothing here for a crawler to reach.
  robots: { index: false, follow: false },
}

export default async function ViralLookPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Sign in and come BACK here, not to the home screen.
  await requireClientPage(viralLookPath(id))

  const look = await loadLiveViralLookForClient(id)

  // Missing, unapproved, moderation-held and pulled all answer the same 404 —
  // a client must not be able to tell a look that was removed from one that
  // never existed.
  if (!look) notFound()

  // AFTER the 404, deliberately. Resolving the tenant reads request headers, and
  // a look nobody is allowed to see has no copy to brand — doing it first made
  // the 404 path depend on a request scope it never needed. The count's scope is
  // platform-wide and the copy names the brand to say so (Tori, 2026-09-15);
  // resolved per tenant, never written as a literal.
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  const platform = platformFromUrl(look.sourceUrl)

  return (
    <ClientPage
      eyebrow={look.categoryName ?? 'Viral look'}
      title={look.name}
      // The count and the list below are counted with the SAME predicate
      // (`OFFERING_PRO_OFFER_WHERE`), so this sentence cannot promise a pro the
      // page does not then name. The sentence itself lives in
      // lib/brand/viralLooksCopy.ts, with the four other surfaces that carry it.
      lede={viralOfferingLede(look.offeringProCount, brand.displayName)}
      back={{ href: '/client', label: 'Home' }}
    >
      <div className="grid gap-4">
        <div className="relative aspect-[2.05/1] overflow-hidden rounded-card border border-textPrimary/10 bg-bgSecondary">
          {/*
            The REVIEWER's cover, or a gradient. The submitter's own attachment
            is never loaded here — `loadLiveViralLookForClient` does not select
            `mediaUrlsJson`, so there is nothing on this page to leak.
          */}
          {look.coverImage ? (
            <RemoteImage
              src={look.coverImage}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              width={672}
              height={328}
            />
          ) : (
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{ background: gradientAvatar(0) }}
            />
          )}

          <div className="absolute inset-x-3.5 top-3.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ember/55 bg-bgPrimary/50 px-2.5 py-[5px]">
              <span className="vl-pulse h-1.5 w-1.5 rounded-full bg-ember" />
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-textPrimary">
                Live now
              </span>
            </span>
            {platform ? (
              <span className="rounded-full bg-bgPrimary/50 px-2.5 py-[5px] font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-textSecondary">
                via {platform}
              </span>
            ) : null}
          </div>
        </div>

        {look.sourceUrl ? (
          <a
            href={look.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={buttonClassName({
              variant: 'ghost',
              size: 'sm',
              shape: 'soft',
              className: 'w-fit',
            })}
          >
            See where it&apos;s from ↗
          </a>
        ) : null}

        <ViralLookPros
          pros={look.pros}
          offeringProCount={look.offeringProCount}
          lookName={look.name}
          brandName={brand.displayName}
        />
      </div>
    </ClientPage>
  )
}
