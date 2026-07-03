// app/p/[handle]/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { friendlyTimeZoneLabel, isValidIanaTimeZone } from '@/lib/timeZone'
import { canViewerSeeProPublicSurface } from '@/lib/proTrustState'
import { normalizeHandle } from '@/lib/handles'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import JsonLdScript from '@/app/_components/seo/JsonLdScript'
import SocialLinkChips from '@/app/_components/profiles/SocialLinkChips'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { loadProProfileSeoByHandle } from '@/lib/profiles/proProfileSeo'
import { absoluteUrl } from '@/lib/seo/absoluteUrl'
import { buildProProfileJsonLd } from '@/lib/seo/proProfileJsonLd'
import { buildProProfileMetadata } from '@/lib/seo/proProfileMetadata'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  const normalized = normalizeHandle(handle)
  if (!normalized) return {}

  let seo: Awaited<ReturnType<typeof loadProProfileSeoByHandle>>
  try {
    seo = await loadProProfileSeoByHandle(normalized)
  } catch {
    // Never let a metadata fetch failure 500 the page; fall back to defaults.
    return {}
  }
  if (!seo) return {}

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return buildProProfileMetadata({
    seo,
    // The vanity mirror canonicalizes to the full profile route so search
    // signals consolidate on one URL.
    canonicalPath: `/professionals/${seo.header.id}`,
    brandDisplayName: brand.displayName,
  })
}

function displayTimeZoneOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tz = raw.trim()
  if (!tz) return null
  return isValidIanaTimeZone(tz) ? tz : null
}

export default async function VanityProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>
}) {
  const { handle } = await params
  const normalized = normalizeHandle(handle)
  if (!normalized) notFound()

  const viewer = await getCurrentUser().catch(() => null)

  const pro = await prisma.professionalProfile.findUnique({
    where: { handleNormalized: normalized },
    select: {
      id: true,
      userId: true,
      verificationStatus: true,
      businessName: true,
      firstName: true,
      lastName: true,
      handle: true,
      nameDisplay: true,
      bio: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      timeZone: true,
      isPremium: true,
      instagramHandle: true,
      tiktokHandle: true,
      websiteUrl: true,
    },
  })

  if (!pro) notFound()

  const canViewPublicSurface = canViewerSeeProPublicSurface({
    viewerRole: viewer?.role ?? null,
    viewerProfessionalId: viewer?.professionalProfile?.id ?? null,
    professionalId: pro.id,
    verificationStatus: pro.verificationStatus,
  })

  if (!canViewPublicSurface) {
    return (
      <main className="mx-auto max-w-180 px-4 pb-24 pt-10">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-[16px] font-black text-textPrimary">
            This profile is pending verification
          </div>
          <div className="mt-2 text-[13px] text-textSecondary">
            We’re verifying the professional’s license and details. Check back soon.
          </div>
        </div>
      </main>
    )
  }

  const displayName = formatProfessionalPublicDisplayName(pro)
  const subtitle = pro.professionType || 'Beauty professional'
  const location = pro.location?.trim() || null
  const proTimeZone = displayTimeZoneOrNull(pro.timeZone)

  // Crawler-facing structured data; cache() dedupes with generateMetadata.
  // Fail-soft: SEO decoration must never break the page render.
  let jsonLd: Record<string, unknown> | null = null
  try {
    const seo = await loadProProfileSeoByHandle(normalized)
    if (seo) {
      const brand = getBrandForTenantContext(
        await resolveTenantContextForLayout(),
      )
      jsonLd = buildProProfileJsonLd({
        seo,
        canonicalUrl: absoluteUrl(`/professionals/${pro.id}`),
        brandDisplayName: brand.displayName,
      })
    }
  } catch {
    jsonLd = null
  }

  return (
    <main className="mx-auto max-w-180 px-4 pb-28 pt-6">
      {jsonLd ? <JsonLdScript data={jsonLd} /> : null}
      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href="/looks"
            className="text-[12px] font-black text-textSecondary hover:text-textPrimary"
          >
            ← Back to Looks
          </Link>

          <Link
            href={`/professionals/${pro.id}`}
            className="text-[12px] font-black text-textSecondary hover:text-textPrimary"
            title="Open the full profile route"
          >
            Open full profile →
          </Link>
        </div>

        <div className="mt-4 flex items-start gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-full border border-white/10 bg-bgPrimary/25">
            {pro.avatarUrl ? (
              <RemoteImage
                src={pro.avatarUrl}
                alt={displayName}
                width={64}
                height={64}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-black text-textPrimary">
              {displayName}
            </div>
            <div className="mt-1 text-[13px] text-textSecondary">
              {subtitle}
              {location ? ` • ${location}` : ''}
            </div>

            {/* Above-the-fold booking CTA: this page doubles as the pro's
                link-in-bio, so the primary action must be visible without
                scrolling. */}
            <Link
              href={`/professionals/${pro.id}?tab=services`}
              className="mt-3 inline-flex items-center rounded-full bg-accentPrimary px-5 py-2.5 text-[13px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
            >
              Book now
            </Link>

            <SocialLinkChips
              instagramHandle={pro.instagramHandle}
              tiktokHandle={pro.tiktokHandle}
              websiteUrl={pro.websiteUrl}
              className="mt-3 flex flex-wrap items-center gap-2"
            />

            {pro.bio ? (
              <div className="mt-3 text-[13px] text-textSecondary">{pro.bio}</div>
            ) : null}

            {proTimeZone ? (
              <div className="mt-3 inline-flex rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textSecondary">
                Time zone: <span className="ml-2 text-textPrimary">{friendlyTimeZoneLabel(proTimeZone) ?? proTimeZone}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  )
}